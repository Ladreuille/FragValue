// api/check-subscription.js - FragValue
// Endpoint client : retourne le plan/statut courant de l'utilisateur.
// Source of truth : helper _lib/subscription.js (DB en priorite, Stripe fallback).
//
// Cet endpoint est appele depuis le front (account.html, dashboard.html, etc.).
// Il ne touche plus directement Stripe : le webhook se charge de tenir la DB
// a jour. Ca evite un round-trip Stripe API a chaque pageview (quota + cout).
const { getUserPlan } = require('./_lib/subscription');

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
  if (!authHeader) return res.status(401).json({ error: 'Non authentifie' });

  try {
    // bypassCache : cet endpoint drive l'UI (badge Pro sur account.html, etc.)
    // donc il doit voir l'etat fresh immediatement apres un webhook
    // (sinon l'user paye → DB mise a jour → mais UI affiche encore Free).
    const result = await getUserPlan(authHeader, { bypassCache: true });
    if (!result.user) return res.status(401).json({ error: 'Token invalide' });

    // Recupere les details de la subscription pour current_period_end + cancel_at_period_end
    // depuis la DB (peuplee par le webhook). Pour l'admin on retourne juste { active }.
    if (result.source === 'admin') {
      return res.status(200).json({ plan: 'elite', status: 'active', isAdmin: true });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: sub } = await sb
      .from('subscriptions')
      .select('current_period_end, status, cancel_at_period_end')
      .eq('user_id', result.user.id)
      .maybeSingle();

    // Si le plan vient d'un grant (parrainage/admin), on utilise sa date
    // d'expiration comme current_period_end pour l'UI
    let periodEnd = sub?.current_period_end
      ? Math.floor(new Date(sub.current_period_end).getTime() / 1000)
      : null;
    if (result.source === 'grant' && result.grant?.expires_at) {
      periodEnd = Math.floor(new Date(result.grant.expires_at).getTime() / 1000);
    }

    return res.status(200).json({
      plan: result.plan,
      status: result.status,
      current_period_end: periodEnd,
      // Propage depuis la DB (peuplee par le webhook 'customer.subscription.updated').
      // TRUE = user a clique "Annuler" mais peut utiliser jusqu'a current_period_end.
      // L'UI account.html peut afficher "Annulation programmee pour le X".
      cancel_at_period_end: !!sub?.cancel_at_period_end,
      _source: result.source,
      grant: result.grant || null, // { reason, expires_at } si le plan vient d'un grant
    });
  } catch (err) {
    console.error('check-subscription error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
