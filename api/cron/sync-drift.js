// api/cron/sync-drift.js
//
// Detection + correction des desync entre 3 sources de verite plan/tier :
//   1. subscriptions.status      (Stripe = source autoritative)
//   2. profiles.subscription_tier (utilisee par les pages frontend / RLS)
//   3. Discord roles              (visible dans le serveur)
//
// Pourquoi un cron et pas trust webhooks :
//   - Webhook Stripe peut etre missed (deploy timing, env var manquante, bug)
//   - Webhook FragValue peut crasher avant l'update profile (cf. bugs precedents)
//   - Discord API peut etre rate-limited / down
//   - Defense en profondeur : une boucle de reconciliation periodique attrape
//     ces drifts silencieux et les corrige sans intervention humaine
//
// Logique :
//   1. SELECT toutes les subscriptions JOIN profiles JOIN discord_links
//   2. Calcule le tier attendu d'apres subscription.status + plan
//   3. Si profile.subscription_tier != expected -> UPDATE profile
//   4. Si discord_link existe et role pas synchro -> Discord API syncUserPlan
//   5. Pareil pour les profiles AVEC subscription_tier != 'free'
//      mais SANS subscription valide -> downgrade
//   6. Track drifts dans GA4 MP (event drift_detected) pour observability
//
// Schedule recommande : 1x/heure (suffisant pour rattraper des bugs sans
// surcharger l'API Discord). Idempotent : si tout est synchro, no-op.
//
// Auth : header Authorization Bearer CRON_SECRET (ou ?secret= en query).

const { createClient } = require('@supabase/supabase-js');

// Mapping subscription -> tier attendu.
// active/trialing = service rendu, paye -> pro/elite selon plan
// past_due       = grace period (~7-14j de dunning) -> on garde pro/elite
// canceled/incomplete_expired/unpaid/incomplete -> free
function expectedTier(status, plan) {
  if (!status) return 'free';
  const isElite = plan && (String(plan).toLowerCase().startsWith('elite') ||
                            String(plan).toLowerCase().startsWith('team'));
  if (status === 'active' || status === 'trialing' || status === 'past_due') {
    return isElite ? 'elite' : 'pro';
  }
  return 'free';
}

module.exports = async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const querySecret = (req.query?.secret) || '';
  const valid =
    (expected && auth === `Bearer ${expected}`) ||
    (expected && querySecret === expected);
  if (!valid) return res.status(401).json({ error: 'Unauthorized' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase env vars missing' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const startedAt = Date.now();
  const drifts = {
    profile_tier_fixed: 0,
    discord_role_fixed: 0,
    profiles_demoted_no_sub: 0,
    failed: 0,
    errors: [],
  };

  try {
    // 1. Tous les users avec une subscription : verif tier expected vs profile
    const { data: subs, error: subErr } = await supabase
      .from('subscriptions')
      .select('user_id, plan, status');
    if (subErr) throw new Error(`subscriptions fetch: ${subErr.message}`);

    if (!subs || subs.length === 0) {
      return res.status(200).json({ ok: true, ...drifts, message: 'no subscriptions', took_ms: Date.now() - startedAt });
    }

    // 2. Pour chaque sub, check + fix profile + Discord
    let syncUserPlan = null;
    try {
      ({ syncUserPlan } = require('../_lib/discord.js'));
    } catch (_) { /* discord helper non dispo : skip Discord sync mais continue profile sync */ }

    for (const s of subs) {
      const tierExpected = expectedTier(s.status, s.plan);

      // Fetch profile + discord_link en parallele
      const [profileRes, linkRes] = await Promise.all([
        supabase.from('profiles').select('subscription_tier').eq('id', s.user_id).maybeSingle(),
        supabase.from('discord_links').select('discord_id').eq('user_id', s.user_id).maybeSingle(),
      ]);
      const profileTier = profileRes.data?.subscription_tier || null;
      const discordId   = linkRes.data?.discord_id || null;

      // 2a. Drift profile.subscription_tier
      if (profileTier !== tierExpected) {
        const { error: updErr } = await supabase
          .from('profiles')
          .update({ subscription_tier: tierExpected })
          .eq('id', s.user_id);
        if (updErr) {
          drifts.failed++;
          if (drifts.errors.length < 10) drifts.errors.push({ user_id: s.user_id, step: 'profile_update', error: updErr.message });
        } else {
          drifts.profile_tier_fixed++;
          console.log(`[sync-drift] profile ${s.user_id} : ${profileTier} -> ${tierExpected} (sub.status=${s.status})`);
        }
      }

      // 2b. Drift Discord role : si user a linke son Discord, on resync
      // syncUserPlan est idempotent (assigne le bon role + retire les autres
      // roles FragValue si different). Best-effort, ne fail pas le run.
      if (discordId && syncUserPlan) {
        try {
          await syncUserPlan(discordId, tierExpected);
          // Note : on ne sait pas s'il y avait drift sans query Discord API.
          // On compte chaque sync comme "potentiellement fix" - peu cher.
          // Pour observability fine, on pourrait fetch le member d'abord et
          // comparer roles[] avec target avant d'appeler. Plus tard.
          drifts.discord_role_fixed++;
        } catch (dscErr) {
          drifts.failed++;
          if (drifts.errors.length < 10) drifts.errors.push({ user_id: s.user_id, step: 'discord_sync', error: dscErr?.message });
        }
      }
    }

    // 3. Cas inverse : profiles avec tier=pro/elite mais SANS subscription du tout
    // (ex: user qui avait Pro, sa subscription a ete deletee de la DB pour X raison
    // mais le profile garde le tier). On les redescend en free.
    const subUserIds = new Set(subs.map(s => s.user_id));
    const { data: orphanedPros } = await supabase
      .from('profiles')
      .select('id, subscription_tier')
      .neq('subscription_tier', 'free');
    if (Array.isArray(orphanedPros)) {
      for (const p of orphanedPros) {
        if (subUserIds.has(p.id)) continue; // a une subscription, deja traite plus haut
        // Pas de subscription mais tier != free -> demote
        await supabase.from('profiles').update({ subscription_tier: 'free' }).eq('id', p.id);
        drifts.profiles_demoted_no_sub++;
        console.log(`[sync-drift] orphan profile ${p.id} demoted ${p.subscription_tier} -> free (no subscription)`);

        // Resync Discord role pour cohérence
        const { data: link } = await supabase.from('discord_links').select('discord_id').eq('user_id', p.id).maybeSingle();
        if (link?.discord_id && syncUserPlan) {
          try { await syncUserPlan(link.discord_id, 'free'); drifts.discord_role_fixed++; } catch (_) {}
        }
      }
    }

    // 4. GA4 MP : track drift_detected si on a fix au moins 1 drift
    // (signal d'un bug a investiguer cote webhook ou autre)
    const totalFixed = drifts.profile_tier_fixed + drifts.profiles_demoted_no_sub;
    if (totalFixed > 0) {
      try {
        const { trackServer } = require('../_lib/ga4-mp.js');
        await trackServer({
          clientId: 'cron.sync-drift',
          events: [{
            name: 'drift_detected',
            params: {
              profile_tier_fixed: drifts.profile_tier_fixed,
              profiles_demoted_no_sub: drifts.profiles_demoted_no_sub,
              discord_role_fixed: drifts.discord_role_fixed,
            },
          }],
        });
      } catch (mpErr) {
        // GA4 MP n'est pas critique, on log et continue
        console.warn('[sync-drift] GA4 MP failed (non-blocking):', mpErr?.message);
      }
    }

    const took_ms = Date.now() - startedAt;
    console.log(`[sync-drift] subs_scanned=${subs.length} profile_tier_fixed=${drifts.profile_tier_fixed} profiles_demoted_no_sub=${drifts.profiles_demoted_no_sub} discord_role_fixed=${drifts.discord_role_fixed} failed=${drifts.failed} took_ms=${took_ms}`);
    return res.status(200).json({ ok: true, subs_scanned: subs.length, ...drifts, took_ms });
  } catch (err) {
    console.error('[sync-drift] fatal:', err);
    return res.status(500).json({ error: err.message, ...drifts });
  }
};
