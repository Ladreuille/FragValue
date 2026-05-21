// api/export-data.js · FragValue
//
// GET /api/export-data
//
// Conformite RGPD art. 20 (droit a la portabilite) : retourne en JSON
// l'integralite des donnees personnelles de l'user authentifie. Format
// machine-readable (JSON) + filename suggere via Content-Disposition.
//
// Tables exportees :
//   - profile          : profiles row (email via auth.users, settings, scout, locale)
//   - subscriptions    : abonnements Stripe (plan, status, dates)
//   - lifetime_purchases : achats LTD si applicable
//   - demos            : metadata des demos analysees (pas le binaire)
//   - feedback         : tickets feedback envoyes
//   - coach_credits    : balance + historique d'achats
//   - referrals        : code parrainage + filleuls
//   - team_members     : invitations team Elite (admin + member)
//   - discord_link     : Discord ID lie
//   - pro_grants       : grants Pro accordes (parrainage, admin, etc.)
//
// Auth : JWT Supabase requis.
// Rate limit : 1 export par 60s par user (anti-abuse).

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

// In-memory rate limit (par instance Vercel). Pas critique pour ce volume.
const lastExportByUser = new Map();
const RATE_LIMIT_MS = 60 * 1000;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth requise' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  try {
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

    // Rate limit
    const lastExport = lastExportByUser.get(user.id);
    if (lastExport && Date.now() - lastExport < RATE_LIMIT_MS) {
      const wait = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastExport)) / 1000);
      return res.status(429).json({ error: `Trop de demandes. Reessaie dans ${wait}s.` });
    }
    lastExportByUser.set(user.id, Date.now());

    // Parallel fetch toutes les tables relevantes. Best-effort : si une
    // table n'existe pas ou erreur RLS, on log mais on continue.
    const safeFetch = async (label, query) => {
      try { const { data, error } = await query; if (error) throw error; return data; }
      catch (e) { console.warn(`[export-data] ${label} failed:`, e.message); return null; }
    };

    const [
      profile, subs, ltds, demos, fb, credits, creditsLog,
      profileReferral, referredUsers, teamAdmin, teamMember, discord, grants,
    ] = await Promise.all([
      safeFetch('profile',         sb.from('profiles').select('*').eq('id', user.id).maybeSingle()),
      safeFetch('subscriptions',   sb.from('subscriptions').select('*').eq('user_id', user.id)),
      safeFetch('lifetime_purchases', sb.from('lifetime_purchases').select('*').eq('user_id', user.id)),
      // Bug ultrareview : avant on selectait `map_name, faceit_match_id, source`
      // qui n'existent pas sur la table demos. Le safeFetch echouait silencieusement
      // -> l'export RGPD retournait demos:[] meme pour un user avec des analyses.
      // Vraies colonnes : id, user_id, map, rounds, total_kills, analysed_at, fv_rating.
      safeFetch('demos',           sb.from('demos').select('id, analysed_at, fv_rating, map, rounds, total_kills').eq('user_id', user.id).order('analysed_at', { ascending: false })),
      // Table 'user_feedback' (pas 'feedback'). Bug trouve a l'ultrareview :
      // l'export silencieusement skipperait les tickets feedback de l'user.
      safeFetch('feedback',        sb.from('user_feedback').select('id, ticket_number, type, message, status, admin_response, created_at, responded_at, tags').eq('user_id', user.id)),
      safeFetch('coach_credits',   sb.from('coach_credits').select('*').eq('user_id', user.id).maybeSingle()),
      safeFetch('coach_credits_log', sb.from('coach_credits_log').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)),
      safeFetch('referral_code',   sb.from('profiles').select('referral_code, referred_by, referred_at').eq('id', user.id).maybeSingle()),
      safeFetch('referred_users',  sb.from('profiles').select('id, referred_at').eq('referred_by', user.id)),
      safeFetch('team_admin',      sb.from('team_members').select('id, email_invited, faceit_nickname, status, invited_at, accepted_at').eq('admin_user_id', user.id)),
      safeFetch('team_member',     sb.from('team_members').select('id, admin_user_id, status, invited_at, accepted_at').eq('member_user_id', user.id)),
      safeFetch('discord_link',    sb.from('discord_links').select('discord_id, discord_username, linked_at').eq('user_id', user.id).maybeSingle()),
      safeFetch('pro_grants',      sb.from('pro_grants').select('*').eq('user_id', user.id)),
    ]);

    const exportData = {
      _meta: {
        generated_at: new Date().toISOString(),
        user_id: user.id,
        export_format_version: '1.0',
        purpose: 'GDPR Article 20 - Right to Data Portability',
        contact_data_protection: 'support@fragvalue.com',
      },
      account: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        email_confirmed_at: user.email_confirmed_at,
        last_sign_in_at: user.last_sign_in_at,
      },
      profile: profile || null,
      subscriptions: subs || [],
      lifetime_purchases: ltds || [],
      demos: demos || [],
      feedback: fb || [],
      coach_credits: {
        balance: credits || null,
        history: creditsLog || [],
      },
      referral: {
        my_code:       profileReferral?.referral_code || null,
        referred_by:   profileReferral?.referred_by || null,
        referred_at:   profileReferral?.referred_at || null,
        my_referrals:  referredUsers || [],
      },
      team: {
        as_admin:  teamAdmin || [],
        as_member: teamMember || [],
      },
      discord:    discord || null,
      pro_grants: grants || [],
    };

    const filename = `fragvalue-export-${user.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(JSON.stringify(exportData, null, 2));
  } catch (err) {
    console.error('[export-data] error:', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
