// api/notify-demo-analyzed.js
// Cree une notification 'Diagnostic IA pret' apres analyse d'une demo.
// Le user voit le badge sur la cloche (.fv-bell de nav.js) la prochaine
// fois qu'il revient sur le site, ce qui le pousse a re-engager.
//
// Auth : JWT Supabase obligatoire.
// Body : { map, fvRating, demoId }
//
// Idempotence cote client : sessionStorage flag (le hook ne POST qu'une
// fois par demoId). Cote serveur : pas de check actif (low cost).

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth requise' });

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

    const body = req.body || {};
    const rawMap = String(body.map || 'de_cs2').slice(0, 50);
    const mapShort = rawMap.replace(/^de_/, '').toUpperCase();
    const fvRatingRaw = body.fvRating;
    const fvRating = (fvRatingRaw != null && !isNaN(parseFloat(fvRatingRaw)))
      ? parseFloat(fvRatingRaw).toFixed(2) : null;
    const demoId = body.demoId || null;

    // i18n : detection de la langue (header X-FV-Lang ou Accept-Language ou referer /en/)
    const langHeader = String(req.headers['x-fv-lang'] || '').toLowerCase();
    const referer = String(req.headers.referer || '');
    const acceptLang = String(req.headers['accept-language'] || '').toLowerCase();
    const isEN = langHeader === 'en'
              || /\/en\//.test(referer)
              || (langHeader === '' && acceptLang.startsWith('en') && !/\/(?!en\/)[a-z]+\.html/.test(referer));

    // Title et message adaptes au resultat (encourage ou pousse a progresser)
    let title, message;
    if (fvRating != null) {
      const r = parseFloat(fvRating);
      if (r >= 1.30) {
        title = isEN ? 'Excellent match' : 'Match excellent';
        message = isEN
          ? `FV ${fvRating} on ${mapShort}. Your heatmaps and AI Coach diagnosis are ready to view.`
          : `FV ${fvRating} sur ${mapShort}. Tes heatmaps et ton diagnostic Coach IA sont prets a etre consultes.`;
      } else if (r >= 1.10) {
        title = isEN ? 'Great performance' : 'Belle performance';
        message = isEN
          ? `FV ${fvRating} on ${mapShort}. Discover your 3 strengths and areas to improve.`
          : `FV ${fvRating} sur ${mapShort}. Decouvre tes 3 forces et tes axes d'amelioration.`;
      } else if (r >= 0.90) {
        title = isEN ? 'Analysis complete' : 'Analyse terminee';
        message = isEN
          ? `FV ${fvRating} on ${mapShort}. See your risky positions and the 7-day action plan.`
          : `FV ${fvRating} sur ${mapShort}. Vois tes positions risquees et le plan d'action 7 jours.`;
      } else {
        title = isEN ? 'Tough match, here are some leads' : 'Match difficile, tu as des pistes';
        message = isEN
          ? `FV ${fvRating} on ${mapShort}. The AI Coach identified 4 concrete actions to bounce back.`
          : `FV ${fvRating} sur ${mapShort}. Le Coach IA a identifie 4 actions concretes pour rebondir.`;
      }
    } else {
      title = isEN ? 'Diagnosis ready' : 'Diagnostic pret';
      message = isEN
        ? `Your ${mapShort} demo is analyzed. Heatmaps, KPIs and action plan are waiting for you.`
        : `Ta demo ${mapShort} est analysee. Heatmaps, KPIs et plan d'action te attendent.`;
    }

    const action_url = demoId ? `/heatmap-results.html?id=${demoId}` : '/heatmap-results.html';

    const { error: insertErr } = await sb.from('notifications').insert({
      user_id: user.id,
      type: 'demo_analyzed',
      title: title.slice(0, 200),
      message: message.slice(0, 500),
      action_url,
      icon: 'chart',
      metadata: { map: rawMap, fv_rating: fvRating, demo_id: demoId },
      read: false,
    });
    if (insertErr) {
      console.error('[notify-demo-analyzed] insert error:', insertErr);
      return res.status(500).json({ error: 'Insert failed' });
    }

    // P0 EMAIL CRITICAL (cf. ultrareview Email lifecycle) : envoie aussi un
    // email push avec preview FV Rating + axe principal Coach IA. Lift attendu
    // +25-40% reactivation post-upload (la personne ferme l'onglet et oublie
    // sans cet email - c'est le pattern Riffstation/Zwift sur les analyses async).
    //
    // Best-effort : si email plante, on ne fail pas la notification in-app.
    // Idempotence cote front : sessionStorage flag, donc 1 seul appel par demoId.
    try {
      // Recupere les infos demo + Coach IA pour enrichir l'email
      // Les stats user-specifiques (kast, adr) sont dans match_players, pas
      // dans demos (qui n'a que fv_rating + rounds + total_kills). On joint
      // par (match_id = demoId) + user_id pour avoir la row du user lui-meme.
      let kast = null, adr = null, mainAxis = null;
      if (demoId) {
        try {
          const { data: mpRow } = await sb
            .from('match_players')
            .select('kast, adr')
            .eq('match_id', demoId)
            .eq('user_id', user.id)
            .maybeSingle();
          if (mpRow) {
            kast = mpRow.kast != null ? Math.round(mpRow.kast) : null;
            adr = mpRow.adr != null ? Math.round(mpRow.adr) : null;
          }
          // mainAxis (axe Coach IA principal) reste null tant que la feature
          // roadmap n'est pas implementee. Le template demoAnalysisReady gere
          // le cas null gracefully (omet la section "axe Coach IA").
        } catch (_) {}
      }

      // Recupere le profile FACEIT nickname si dispo + l'email du user
      const { data: profile } = await sb
        .from('profiles')
        .select('faceit_nickname')
        .eq('id', user.id)
        .maybeSingle();
      const email = user.email;

      if (email && demoId) {
        const tpl = require('./_lib/email-templates.js');
        const { sendEmail } = await import('./_lib/email.js');
        const t = tpl.demoAnalysisReady({
          nickname: profile?.faceit_nickname || email.split('@')[0],
          demoId,
          map: rawMap,
          fvRating: fvRating ? parseFloat(fvRating) : null,
          kast,
          adr,
          mainAxis,
        });
        await sendEmail({ to: email, subject: t.subject, html: t.html, text: t.text });
        console.log(`[notify-demo-analyzed] email sent to ${email} for demo ${demoId}`);
      }
    } catch (emailErr) {
      console.warn('[notify-demo-analyzed] email failed (non-blocking):', emailErr?.message);
    }

    // P1 DISCORD BACKUP (cf. ultrareview Onboarding) : si le user a un Discord
    // lie (table discord_links), on lui envoie aussi un DM via le bot avec un
    // lien vers ses heatmaps. C'est une voie de fallback : si son email est
    // dans le spam ou s'il est plus actif sur Discord, il recoit quand meme
    // le ping. Best-effort : si Discord plante (DMs bloques, bot offline,
    // permissions), on ne fail pas la notification in-app.
    try {
      const { data: dLink } = await sb
        .from('discord_links')
        .select('discord_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (dLink?.discord_id && demoId) {
        const { sendDirectMessage } = require('./_lib/discord.js');
        const siteUrl = process.env.SITE_URL || 'https://fragvalue.com';
        const link = `${siteUrl}/heatmap-results.html?id=${demoId}`;
        // Format embed Discord : couleur accent FragValue (#b8ff57 = 0xB8FF57)
        // visuellement coherent avec le branding. Fallback content text pour
        // les clients Discord qui n'affichent pas les embeds (rares).
        const fvLine = fvRating
          ? (isEN ? `**FV Rating** ${fvRating}` : `**FV Rating** ${fvRating}`)
          : '';
        const statsLine = (kast != null && adr != null)
          ? (isEN
              ? `KAST ${kast}% · ADR ${adr}`
              : `KAST ${kast}% · ADR ${adr}`)
          : '';
        const descLines = [fvLine, statsLine].filter(Boolean).join('\n');
        const payload = {
          content: isEN
            ? `Your **${mapShort}** analysis is ready. ${link}`
            : `Ton analyse **${mapShort}** est prete. ${link}`,
          embeds: [{
            title: isEN ? 'FragValue · Analysis ready' : 'FragValue · Analyse prete',
            description: descLines || undefined,
            color: 0xB8FF57,
            url: link,
            footer: {
              text: isEN
                ? 'Heatmaps, AI Coach diagnosis and 7-day action plan'
                : 'Heatmaps, diagnostic Coach IA et plan d\'action 7 jours',
            },
          }],
        };
        await sendDirectMessage(dLink.discord_id, payload);
        console.log(`[notify-demo-analyzed] discord DM sent to ${dLink.discord_id} for demo ${demoId}`);
      }
    } catch (dmErr) {
      // 403 = user a desactive les DMs du bot. Pas grave, on log et on continue.
      // 50007 = "Cannot send messages to this user" (idem, user a bloque)
      console.warn('[notify-demo-analyzed] discord DM failed (non-blocking):', dmErr?.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-demo-analyzed] error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
