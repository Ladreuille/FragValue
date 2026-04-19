// api/pro-match.js
// Détail d'un match pro : maps + scorecard par joueur.
//
// GET /api/pro-match?id=<uuid>
//
// Returns:
//   { match: {...event, match data, maps: [{ name, score, players: [...] }] } }
//
// Pro paywall : les stats détaillées sont réservées aux plans Pro/Elite.
// Pour un user Free ou anon : on retourne le match meta mais pas les players.

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const ADMIN_EMAILS = ['qdreuillet@gmail.com'];

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function getUserPlan(authHeader) {
  if (!authHeader) {
    console.log('[pro-match] no auth header');
    return { plan: 'free', user: null, reason: 'no-auth-header' };
  }
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return { plan: 'free', user: null, reason: 'empty-token' };

  const s = sb();
  const { data, error } = await s.auth.getUser(token);
  if (error) console.warn('[pro-match] auth.getUser error:', error.message);
  const user = data?.user;
  if (!user) {
    console.log('[pro-match] token valid but no user returned');
    return { plan: 'free', user: null, reason: 'no-user' };
  }

  console.log('[pro-match] user resolved email=' + user.email);

  // Admin bypass
  if (user.email && ADMIN_EMAILS.includes(user.email)) {
    return { plan: 'team', user, reason: 'admin' };
  }

  // Resolve plan via stripe_customer_id (source of truth Stripe)
  try {
    const { data: profile } = await s
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    if (!profile?.stripe_customer_id) return { plan: 'free', user };
    if (!process.env.STRIPE_SECRET_KEY) return { plan: 'free', user };
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const subs = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: 'active',
      limit: 1,
    });
    if (!subs.data.length) return { plan: 'free', user };
    const priceId = subs.data[0].items.data[0]?.price?.id || '';
    let plan = 'pro';
    if (priceId.includes('team') || priceId.includes('elite')) plan = 'team';
    return { plan, user };
  } catch {
    return { plan: 'free', user };
  }
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = req.query?.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'id requis (uuid)' });
  }

  try {
    const s = sb();
    const { plan, reason } = await getUserPlan(req.headers.authorization);
    const isPaid = plan === 'pro' || plan === 'team';
    console.log('[pro-match] plan=' + plan + ' isPaid=' + isPaid + ' reason=' + reason);

    // 1. Match meta + event
    const { data: match, error: matchErr } = await s
      .from('pro_matches')
      .select(`
        id, stage, format, team_a, team_b, team_a_logo, team_b_logo,
        team_a_score, team_b_score, winner, best_player, best_rating,
        match_date, demo_available,
        pro_events (id, name, short_name, tier, prize_pool, start_date)
      `)
      .eq('id', id)
      .single();
    if (matchErr || !match) return res.status(404).json({ error: 'Match introuvable' });

    // 2. Maps jouées
    const { data: maps } = await s
      .from('pro_match_maps')
      .select('*')
      .eq('match_id', id)
      .order('map_order');

    // 3. Players (gated : scorecard seulement si plan paid)
    let playersByMap = {};
    if (isPaid && maps?.length) {
      const { data: players } = await s
        .from('pro_match_players')
        .select('*')
        .in('match_map_id', maps.map(m => m.id))
        .order('hltv_rating', { ascending: false });
      (players || []).forEach(p => {
        if (!playersByMap[p.match_map_id]) playersByMap[p.match_map_id] = [];
        playersByMap[p.match_map_id].push({
          nickname: p.nickname,
          team: p.team,
          country: p.country,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          adr: p.adr ? Number(p.adr) : null,
          kast_pct: p.kast_pct ? Number(p.kast_pct) : null,
          hltv_rating: p.hltv_rating ? Number(p.hltv_rating) : null,
          first_kills: p.first_kills,
          first_deaths: p.first_deaths,
        });
      });
    }

    // Cache-Control private implique qu'aucun CDN ne cachera. On desactive
    // aussi le cache browser pour eviter qu'un user qui se logge apres
    // l'affichage free voit toujours le paywall via cache local.
    res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
    return res.status(200).json({
      plan,
      isPaid,
      _debug: { reason, hasAuth: !!req.headers.authorization },
      match: {
        id: match.id,
        stage: match.stage,
        format: match.format,
        team_a: match.team_a,
        team_b: match.team_b,
        team_a_logo: match.team_a_logo,
        team_b_logo: match.team_b_logo,
        team_a_score: match.team_a_score,
        team_b_score: match.team_b_score,
        winner: match.winner,
        best_player: match.best_player,
        best_rating: match.best_rating ? Number(match.best_rating) : null,
        match_date: match.match_date,
        demo_available: match.demo_available,
        event: match.pro_events ? {
          name: match.pro_events.name,
          short_name: match.pro_events.short_name,
          tier: match.pro_events.tier,
          prize_pool: match.pro_events.prize_pool,
        } : null,
        maps: (maps || []).map(m => ({
          id: m.id,
          order: m.map_order,
          name: m.map_name,
          score_a: m.team_a_score,
          score_b: m.team_b_score,
          picked_by: m.picked_by,
          duration_min: m.duration_min,
          players: playersByMap[m.id] || [],
        })),
      },
    });
  } catch (e) {
    console.error('pro-match error', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
