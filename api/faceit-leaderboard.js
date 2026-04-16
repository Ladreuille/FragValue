// api/faceit-leaderboard.js
// Retourne le top N joueurs FACEIT CS2 d'une region (EU par defaut) avec ELO,
// pseudo, avatar, pays, et stats rapides si disponibles.
// Cache Supabase 1h pour eviter de hammer l'API FACEIT (3000 req/jour).

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_REGION = 'EU';
const DEFAULT_LIMIT  = 5;
const CACHE_TTL_MIN  = 60; // 1h
const FACEIT_BASE    = 'https://open.faceit.com/data/v4';

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function readCache(region) {
  try {
    const sb = getSb();
    if (!sb) return null;
    const { data } = await sb
      .from('faceit_leaderboard_cache')
      .select('payload, cached_at')
      .eq('region', region)
      .single();
    if (!data) return null;
    const age = (Date.now() - new Date(data.cached_at).getTime()) / 60000;
    if (age > CACHE_TTL_MIN) return null;
    return data.payload;
  } catch { return null; }
}

async function writeCache(region, payload) {
  try {
    const sb = getSb();
    if (!sb) return;
    await sb.from('faceit_leaderboard_cache').upsert({
      region,
      payload,
      cached_at: new Date().toISOString(),
    }, { onConflict: 'region' });
  } catch {}
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const region = (req.query.region || DEFAULT_REGION).toUpperCase();
  const limit  = Math.min(parseInt(req.query.limit) || DEFAULT_LIMIT, 20);

  const API_KEY = process.env.FACEIT_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'FACEIT API key manquante' });

  // Cache hit
  const cached = await readCache(region);
  if (cached && Array.isArray(cached.players)) {
    return res.status(200).json({ ...cached, cached: true });
  }

  const headers = { Authorization: 'Bearer ' + API_KEY };

  try {
    // 1. Fetch ranking top N
    const rankRes = await fetch(
      `${FACEIT_BASE}/rankings/games/cs2/regions/${encodeURIComponent(region)}?limit=${limit}&offset=0`,
      { headers }
    );
    if (!rankRes.ok) {
      return res.status(rankRes.status).json({ error: 'FACEIT rankings error ' + rankRes.status });
    }
    const rankData = await rankRes.json();
    const items = rankData.items || [];

    // 2. Enrichir chaque joueur avec nickname, country, avatar, et K/D lifetime
    const players = await Promise.all(items.map(async (item) => {
      const playerId = item.player_id;
      const nickname = item.nickname;
      const elo      = item.faceit_elo;
      const position = item.position;
      const country  = item.country;

      // Fetch player profile + stats en parallele
      const [profileRes, statsRes] = await Promise.allSettled([
        fetch(`${FACEIT_BASE}/players/${playerId}`, { headers }).then(r => r.ok ? r.json() : null),
        fetch(`${FACEIT_BASE}/players/${playerId}/stats/cs2`, { headers }).then(r => r.ok ? r.json() : null),
      ]);

      const profile = profileRes.status === 'fulfilled' ? profileRes.value : null;
      const stats   = statsRes.status === 'fulfilled' ? statsRes.value : null;
      const life    = stats?.lifetime || {};

      return {
        rank:     position,
        nickname,
        playerId,
        country:  (country || '').toUpperCase(),
        avatar:   profile?.avatar || null,
        elo,
        kd:       parseFloat(life['Average K/D Ratio']) || null,
        adr:      parseFloat(life['ADR']) || null,
        hsPct:    parseFloat(life['Average Headshots %']) || null,
        matches:  parseInt(life['Matches']) || null,
        winRate:  parseFloat(life['Win Rate %']) || null,
      };
    }));

    const payload = {
      region,
      updatedAt: new Date().toISOString(),
      players,
    };

    // Write cache (fire-and-forget)
    writeCache(region, payload).catch(() => {});

    return res.status(200).json({ ...payload, cached: false });
  } catch (err) {
    console.error('faceit-leaderboard error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
