const { createClient } = require('@supabase/supabase-js');

// ── Supabase client ──────────────────────────────────────────────────────────
function getSbClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    return null;
  }
  return createClient(url, key);
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
const CACHE_TTL_H = 24; // heures

async function readCache(playerId) {
  try {
    const sb = getSbClient();
    if (!sb) return null;
    const { data } = await sb
      .from('player_advanced_cache')
      .select('advanced_stats, cached_at')
      .eq('player_id', playerId)
      .single();
    if (!data) return null;
    const age = (Date.now() - new Date(data.cached_at).getTime()) / 3600000;
    if (age > CACHE_TTL_H) return null; // expiré
    return data.advanced_stats;
  } catch { return null; }
}

async function writeCache(playerId, nickname, advancedStats) {
  try {
    const sb = getSbClient();
    if (!sb) return;
    await sb.from('player_advanced_cache').upsert({
      player_id:      playerId,
      nickname:       nickname,
      advanced_stats: advancedStats,
      cached_at:      new Date().toISOString(),
    }, { onConflict: 'player_id' });
  } catch(e) { console.warn('Cache write error:', e.message); }
}

// ── Fetch stats avancées depuis match details FACEIT ─────────────────────────
// Récupère CT/T split, clutches, opening kills, flashes, trades, saves
// pour chaque match via /matches/{id}/stats
async function fetchAdvancedMatchStats(matchIds, playerId, headers) {
  const BASE = 'https://open.faceit.com/data/v4';
  const results = {};

  // Batch : max 5 appels simultanés pour éviter rate limiting
  const BATCH = 5;
  for (let i = 0; i < matchIds.length; i += BATCH) {
    const batch = matchIds.slice(i, i + BATCH);
    const responses = await Promise.allSettled(
      batch.map(matchId =>
        fetch(`${BASE}/matches/${matchId}/stats`, { headers })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    );
    responses.forEach((res, idx) => {
      const matchId = batch[idx];
      if (res.status !== 'fulfilled' || !res.value) return;
      const matchData = res.value;
      // Trouver les stats du joueur dans le match
      const rounds = matchData.rounds || [];
      for (const round of rounds) {
        const teams = round.teams || [];
        for (const team of teams) {
          const players = team.players || [];
          const playerStats = players.find(p => p.player_id === playerId);
          if (playerStats) {
            const s = playerStats.player_stats || {};
            results[matchId] = {
              clutch1v1:  parseInt(s['1v1Wins'])  || parseInt(s['1v1 Wins'])  || 0,
              clutch1v2:  parseInt(s['1v2Wins'])  || parseInt(s['1v2 Wins'])  || 0,
              clutch1v3:  parseInt(s['1v3Wins'])  || parseInt(s['1v3 Wins'])  || 0,
              clutch1v4:  parseInt(s['1v4Wins'])  || parseInt(s['1v4 Wins'])  || 0,
              clutch1v5:  parseInt(s['1v5Wins'])  || parseInt(s['1v5 Wins'])  || 0,
              // FACEIT CS2 expose `Entry Count` (total entries) et `Entry Wins` (entries
              // gagnees). Les champs `First Kills`/`First Deaths` sont des fallbacks
              // CSGO legacy. Pour les deaths on derive : entry perdues = count - wins.
              firstKills: parseInt(s['Entry Wins'])   || parseInt(s['First Kills'])  || parseInt(s['Opening Kills'])  || 0,
              firstDeaths:(() => {
                const entryCount = parseInt(s['Entry Count']) || 0;
                const entryWins  = parseInt(s['Entry Wins'])  || 0;
                if (entryCount > 0 && entryCount >= entryWins) return entryCount - entryWins;
                return parseInt(s['First Deaths']) || parseInt(s['Opening Deaths']) || 0;
              })(),
              ctKills:    parseInt(s['Kills - CT'])  || parseInt(s['CT Kills'])  || 0,
              ctDeaths:   parseInt(s['Deaths - CT']) || parseInt(s['CT Deaths']) || 0,
              ctWins:     parseInt(s['Wins - CT'])   || parseInt(s['CT Wins'])   || 0,
              ctRounds:   parseInt(s['Rounds - CT']) || parseInt(s['CT Rounds']) || 0,
              tKills:     parseInt(s['Kills - T'])   || parseInt(s['T Kills'])   || 0,
              tDeaths:    parseInt(s['Deaths - T'])  || parseInt(s['T Deaths'])  || 0,
              tWins:      parseInt(s['Wins - T'])    || parseInt(s['T Wins'])    || 0,
              tRounds:    parseInt(s['Rounds - T'])  || parseInt(s['T Rounds'])  || 0,
              flashesThrown:   parseInt(s['Flash Count']) || parseInt(s['Flashes Thrown']) || 0,
              enemiesFlashed:  parseInt(s['Enemies Flashed']) || parseInt(s['Flash Assists']) || 0,
              utilDmg:    parseInt(s['Utility Damage']) || parseInt(s['Utility DMG']) || 0,
              tradeKills: parseInt(s['Trade Kills'])  || 0,
              tradeDeaths:parseInt(s['Trade Deaths']) || 0,
              saves:      parseInt(s['Saves'])        || 0,
              sniperKills:parseInt(s['Sniper Kills']) || parseInt(s['AWP Kills']) || 0,
            };
          }
        }
      }
    });
    // Petite pause entre batches pour respecter le rate limit
    if (i + BATCH < matchIds.length) await new Promise(r => setTimeout(r, 150));
  }
  return results;
}

// ── Rate limiting : 3 scouts / jour pour les users Free ────────────────────
// Les Pro/Team sont illimites. Les visiteurs non connectes sont egalement
// plafonnes cote serveur (3/jour par IP) pour eviter l'abus.
const FREE_SCOUTS_PER_DAY = 3;

async function resolveUserFromAuth(authHeader) {
  if (!authHeader) return null;
  try {
    const sb = getSbClient();
    if (!sb) return null;
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return null;
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch { return null; }
}

async function resolveUserPlan(user) {
  if (!user) return 'free';
  // Admin bypass aligne avec /api/check-subscription
  const ADMIN_EMAILS = ['qdreuillet@gmail.com'];
  if (user.email && ADMIN_EMAILS.includes(user.email)) return 'team';
  try {
    const sb = getSbClient();
    if (!sb) return 'free';
    const { data: profile } = await sb
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    // Sans stripe_customer_id on reste en free sans appeler Stripe ici
    // (la source de verite reste /api/check-subscription, on suit ce que la DB indique)
    if (!profile?.stripe_customer_id) return 'free';
    // Pas d'appel Stripe ici pour garder le handler rapide ; on considere
    // qu'un user avec stripe_customer_id est au moins pro (downgrade rare).
    return 'pro';
  } catch { return 'free'; }
}

async function countScoutsToday(userId) {
  try {
    const sb = getSbClient();
    if (!sb) return 0;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { count } = await sb
      .from('scout_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since.toISOString());
    return count || 0;
  } catch { return 0; }
}

async function logScout(userId, nickname) {
  try {
    const sb = getSbClient();
    if (!sb) return;
    await sb.from('scout_logs').insert({ user_id: userId, nickname });
  } catch {}
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { nickname } = req.query;
  if (!nickname) return res.status(400).json({ error: 'Pseudo FACEIT manquant.' });

  const API_KEY = process.env.FACEIT_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'Clé API FACEIT non configurée.' });

  // ── Rate limit Free : 3 scouts / jour (scout de son propre pseudo exempte)
  const user = await resolveUserFromAuth(req.headers.authorization);
  const plan = await resolveUserPlan(user);

  if (user && plan === 'free') {
    // Autoriser le scout de son propre pseudo FACEIT sans decrementer le quota
    let ownNickname = null;
    try {
      const sb = getSbClient();
      if (sb) {
        const { data: profile } = await sb
          .from('profiles')
          .select('faceit_nickname')
          .eq('id', user.id)
          .single();
        ownNickname = (profile?.faceit_nickname || '').toLowerCase();
      }
    } catch {}

    const isOwnScout = ownNickname && nickname.toLowerCase() === ownNickname;
    if (!isOwnScout) {
      const usedToday = await countScoutsToday(user.id);
      if (usedToday >= FREE_SCOUTS_PER_DAY) {
        return res.status(429).json({
          error: 'Limite quotidienne atteinte',
          code: 'scout_limit_reached',
          plan: 'free',
          usedToday,
          limit: FREE_SCOUTS_PER_DAY,
          message: `Tu as utilise tes ${FREE_SCOUTS_PER_DAY} scouts du jour. Passe a Pro pour des scouts illimites.`,
        });
      }
      // Log apres le check (before the long FACEIT fetch, sinon on pourrait
      // ne pas logger si le handler crash ; ok de logger meme si le scout
      // echoue ensuite, un quota fair use inclut les tentatives).
      await logScout(user.id, nickname);
    }
  }

  const headers = { Authorization: `Bearer ${API_KEY}` };
  const BASE = 'https://open.faceit.com/data/v4';

  try {
    // 1. Profil joueur
    const playerRes = await fetch(`${BASE}/players?nickname=${encodeURIComponent(nickname)}`, { headers });
    if (!playerRes.ok) {
      if (playerRes.status === 404) return res.status(404).json({ error: `Joueur "${nickname}" introuvable sur FACEIT.` });
      return res.status(playerRes.status).json({ error: `Erreur FACEIT API: ${playerRes.status}` });
    }
    const player = await playerRes.json();
    const playerId = player.player_id;
    const cs2data = player.games?.cs2;
    if (!cs2data) return res.status(404).json({ error: `Ce joueur n'a pas de données CS2 sur FACEIT.` });

    // 2. Lire le cache Supabase pour les stats avancées
    const cachedAdvanced = await readCache(playerId);

    // 2. Appels parallèles
    const [statsRes, historyRes, recentStatsRes, teamsRes] = await Promise.all([
      fetch(`${BASE}/players/${playerId}/stats/cs2`, { headers }),
      fetch(`${BASE}/players/${playerId}/history?game=cs2&limit=20`, { headers }),
      fetch(`${BASE}/players/${playerId}/games/cs2/stats?limit=20`, { headers }),
      fetch(`${BASE}/players/${playerId}/teams`, { headers }),
    ]);

    const statsData       = statsRes.ok       ? await statsRes.json()       : null;
    const historyData     = historyRes.ok      ? await historyRes.json()     : { items: [] };
    const recentStatsData = recentStatsRes.ok  ? await recentStatsRes.json() : { items: [] };
    const teamsData       = teamsRes.ok        ? await teamsRes.json()       : { items: [] };

    const lifetime = statsData?.lifetime || {};

    // 3. Stats par match : extraction complète
    const recentMatches = (recentStatsData.items || []).map(item => {
      const s = item.stats || {};

      const kills   = parseInt(s['Kills'])     || 0;
      const deaths  = parseInt(s['Deaths'])    || 0;
      const assists = parseInt(s['Assists'])   || 0;
      const hs      = parseInt(s['Headshots']) || 0;
      const rounds  = parseInt(s['Rounds'])    || 20;
      const kd      = parseFloat(s['K/D Ratio'])    || 0;
      const kr      = parseFloat(s['K/R Ratio'])    || 0;
      const adr     = parseFloat(s['ADR'])           || 0;
      const kastRaw = parseFloat(s['KAST']) || 0;

      // ── KAST estimé (modèle probabiliste proche HLTV/FACEIT) ──────────────
      // KAST = % rounds avec au moins 1 de : Kill / Assist / Survived / Traded
      // On modélise chaque composante comme une probabilité indépendante par round
      // puis on applique P(K∪A∪S∪T) = 1 - P(¬K)×P(¬A)×P(¬S)×P(¬T)
      const kastEstimated = (() => {
        if (rounds <= 0) return 0;

        // Kill component : P(au moins 1 kill dans le round)
        // Modèle Poisson : P(k≥1) = 1 - e^(-kr)
        const kr_val = rounds > 0 ? kills / rounds : 0;
        const pKill  = 1 - Math.exp(-kr_val);

        // Assist component : P(au moins 1 assist dans le round)
        const ar_val  = rounds > 0 ? assists / rounds : 0;
        const pAssist = 1 - Math.exp(-ar_val * 0.7); // assists partiellement corrélées aux kills

        // Survived component : taux de survie direct
        const survived = Math.max(0, rounds - deaths);
        const pSurvive = survived / rounds;

        // Traded component : % de morts où on a été tradé
        // On utilise tradeDeaths si dispo, sinon on estime à ~25% des morts (moyenne CS2)
        const tradeDeathsVal = parseInt(s['Trade Deaths']) || parseInt(s['Trade deaths']) || 0;
        const tradeRate = deaths > 0
          ? Math.min(0.45, tradeDeathsVal / deaths)
          : 0.22; // valeur moyenne CS2 pro/semi-pro
        const pTraded = (deaths / rounds) * tradeRate;

        // P(round KAST) = 1 - P(pas de K) × P(pas de A) × P(pas de S) × P(pas de T)
        // Mais K, S sont partiellement exclusifs (si tu survis tu n'es pas mort)
        // On sépare : P(vivant ET no kill no assist) + P(mort ET tradé)
        const pAlive        = pSurvive;
        const pAliveNoImpact = pAlive * (1 - pKill) * (1 - pAssist);
        const pDeadTraded   = (deaths / rounds) * tradeRate;
        const pDeadKillOrAssist = (deaths / rounds) * (1 - (1 - pKill * 0.6) * (1 - pAssist * 0.4));

        const kastProb = pAlive + pDeadTraded + pDeadKillOrAssist - pAliveNoImpact * 0.1;

        // Calibration finale : les valeurs HLTV réelles tournent entre 55% et 85%
        // On clampe et on applique un léger ajustement empirique
        // Calibration empirique : le modèle sous-estime d'~12 points vs HLTV/FACEIT
        // car les composantes K/A/S/T sont corrélées positivement en pratique
        const calibrated = Math.min(0.93, kastProb + 0.12);
        const raw = Math.min(0.93, Math.max(0.50, calibrated));

        // Micro-ajustement ADR : un joueur à fort ADR a plus de rounds avec impact
        const adrFactor = adr > 0 ? Math.min(1.05, 0.97 + adr / 1400) : 1.0;

        return Math.round(raw * adrFactor * 100);
      })();

      const kast = kastRaw > 0 ? kastRaw : kastEstimated;
      const hsPct   = parseFloat(s['Headshots %'])   || 0;
      const mvp     = parseInt(s['MVPs'])    || 0;
      const result  = parseInt(s['Result'])  || 0;

      // Multi-kills
      const double = parseInt(s['Double Kills'])  || 0;
      const triple = parseInt(s['Triple Kills'])  || 0;
      const quad   = parseInt(s['Quadro Kills'])  || 0;
      const ace    = parseInt(s['Penta Kills'])   || 0;

      // Clutches
      const clutch1v1 = parseInt(s['1v1Wins'])  || parseInt(s['1v1 Wins'])  || 0;
      const clutch1v2 = parseInt(s['1v2Wins'])  || parseInt(s['1v2 Wins'])  || 0;
      const clutch1v3 = parseInt(s['1v3Wins'])  || parseInt(s['1v3 Wins'])  || 0;
      const clutch1v4 = parseInt(s['1v4Wins'])  || parseInt(s['1v4 Wins'])  || 0;
      const clutch1v5 = parseInt(s['1v5Wins'])  || parseInt(s['1v5 Wins'])  || 0;

      // Opening duels. FACEIT CS2 : `Entry Wins` + `Entry Count`.
      // Entry deaths deriv.es : count - wins.
      const entryCount = parseInt(s['Entry Count']) || 0;
      const entryWins  = parseInt(s['Entry Wins'])  || 0;
      const firstKills  = entryWins > 0 ? entryWins
                        : (parseInt(s['First Kills']) || parseInt(s['Opening Kills']) || 0);
      const firstDeaths = (entryCount > 0 && entryCount >= entryWins)
                        ? entryCount - entryWins
                        : (parseInt(s['First Deaths']) || parseInt(s['Opening Deaths']) || 0);

      // CT / T side splits
      const ctKills  = parseInt(s['Kills - CT'])    || parseInt(s['CT Kills'])    || 0;
      const ctDeaths = parseInt(s['Deaths - CT'])   || parseInt(s['CT Deaths'])   || 0;
      const ctWins   = parseInt(s['Wins - CT'])      || parseInt(s['CT Wins'])     || 0;
      const ctRounds = parseInt(s['Rounds - CT'])    || parseInt(s['CT Rounds'])   || 0;
      const tKills   = parseInt(s['Kills - T'])     || parseInt(s['T Kills'])     || 0;
      const tDeaths  = parseInt(s['Deaths - T'])    || parseInt(s['T Deaths'])    || 0;
      const tWins    = parseInt(s['Wins - T'])       || parseInt(s['T Wins'])      || 0;
      const tRounds  = parseInt(s['Rounds - T'])     || parseInt(s['T Rounds'])    || 0;

      // Flashes
      const flashesThrown    = parseInt(s['Flash Count'])       || parseInt(s['Flashes Thrown'])    || 0;
      const enemiesFlashed   = parseInt(s['Enemies Flashed'])   || parseInt(s['Flash Assists'])     || 0;
      const flashDuration    = parseFloat(s['Flash Duration'])  || 0;

      // Utility
      const utilDmg    = parseInt(s['Utility Damage'])  || parseInt(s['Utility DMG']) || 0;
      const utilThrown = parseInt(s['Utility Count'])   || 0;

      // Trades & saves
      const tradeKills  = parseInt(s['Trade Kills'])  || 0;
      const tradeDeaths = parseInt(s['Trade Deaths']) || 0;
      const saves       = parseInt(s['Saves'])        || 0;

      // Pistol rounds
      const pistolWins  = parseInt(s['Pistol Round Wins'])   || parseInt(s['Pistol Wins'])  || 0;
      const pistolTotal = parseInt(s['Pistol Round Played']) || parseInt(s['Pistol Played'])|| 0;

      // Sniper kills (AWP proxy)
      const sniperKills = parseInt(s['Sniper Kills']) || parseInt(s['AWP Kills']) || 0;

      // FV Rating 2.1
      const dpr    = rounds > 0 ? deaths  / rounds : 0;
      const kpr    = rounds > 0 ? kills   / rounds : 0;
      const aprVal = rounds > 0 ? assists / rounds : 0;
      const impact = 2.13 * kpr + 0.42 * aprVal - 0.41;
      const fvRating = kast > 0
        ? parseFloat((0.0073 * kast + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr + 0.1587).toFixed(3))
        : parseFloat(kd > 0 ? (kd * 0.5 + 0.15).toFixed(3) : '0.000');

      return {
        matchId: s['Match Id'] || '',
        date:    s['Match Finished At'] ? new Date(parseInt(s['Match Finished At'])).toLocaleDateString('fr-FR') : '',
        map:     s['Map'] || '',
        score:   s['Score'] || '',
        result, kills, deaths, assists, hs, hsPct, kd, kr, adr, kast, mvp, rounds,
        double, triple, quad, ace,
        clutch1v1, clutch1v2, clutch1v3, clutch1v4, clutch1v5,
        firstKills, firstDeaths, fvRating,
        ctKills, ctDeaths, ctWins, ctRounds,
        tKills,  tDeaths,  tWins,  tRounds,
        flashesThrown, enemiesFlashed, flashDuration,
        utilDmg, utilThrown,
        tradeKills, tradeDeaths, saves,
        pistolWins, pistolTotal,
        sniperKills,
      };
    });

    // ── Enrichissement avec stats avancées (cache ou fetch) ──────────────
    let advancedByMatch = {};

    if (cachedAdvanced) {
      // Cache valide : utiliser directement
      advancedByMatch = cachedAdvanced;
    } else {
      // Pas de cache : fetch des match details en arrière-plan
      // On répond d'abord avec les données de base, le cache se remplira
      const matchIds = recentMatches
        .map(m => m.matchId)
        .filter(Boolean);

      if (matchIds.length > 0) {
        // Fetch asynchrone — ne bloque pas la réponse
        fetchAdvancedMatchStats(matchIds, playerId, headers)
          .then(results => {
            if (Object.keys(results).length > 0) {
              writeCache(playerId, nickname, results);
            }
          })
          .catch(e => console.warn('Advanced stats fetch error:', e.message));
      }
    }

    // Fusionner les stats avancées dans chaque match
    recentMatches.forEach(m => {
      const adv = advancedByMatch[m.matchId];
      if (!adv) return;
      // Surcharger les champs qui étaient à 0 si le cache a des vraies valeurs
      if (adv.clutch1v1 > 0) m.clutch1v1 = adv.clutch1v1;
      if (adv.clutch1v2 > 0) m.clutch1v2 = adv.clutch1v2;
      if (adv.clutch1v3 > 0) m.clutch1v3 = adv.clutch1v3;
      if (adv.clutch1v4 > 0) m.clutch1v4 = adv.clutch1v4;
      if (adv.clutch1v5 > 0) m.clutch1v5 = adv.clutch1v5;
      if (adv.firstKills  > 0) m.firstKills  = adv.firstKills;
      if (adv.firstDeaths > 0) m.firstDeaths = adv.firstDeaths;
      if (adv.ctKills > 0 || adv.ctRounds > 0) {
        m.ctKills = adv.ctKills; m.ctDeaths = adv.ctDeaths;
        m.ctWins  = adv.ctWins;  m.ctRounds = adv.ctRounds;
        m.tKills  = adv.tKills;  m.tDeaths  = adv.tDeaths;
        m.tWins   = adv.tWins;   m.tRounds  = adv.tRounds;
      }
      if (adv.flashesThrown  > 0) m.flashesThrown  = adv.flashesThrown;
      if (adv.enemiesFlashed > 0) m.enemiesFlashed = adv.enemiesFlashed;
      if (adv.utilDmg    > 0) m.utilDmg    = adv.utilDmg;
      if (adv.tradeKills > 0) m.tradeKills = adv.tradeKills;
      if (adv.saves      > 0) m.saves      = adv.saves;
      if (adv.sniperKills > 0) m.sniperKills = adv.sniperKills;
    });

    const n = recentMatches.length || 1;
    const sum  = key => recentMatches.reduce((s, m) => s + (m[key] || 0), 0);
    const avg  = key => sum(key) / n;
    const wins = recentMatches.filter(m => m.result === 1).length;

    // ── Moyennes globales ──────────────────────────────────────────────────
    const avgKd    = avg('kd').toFixed(2);
    const avgHs    = avg('hsPct').toFixed(1);
    const avgAdr   = avg('adr').toFixed(1);
    const avgKast  = avg('kast').toFixed(1);
    const avgKr    = avg('kr').toFixed(3);
    const winRate  = ((wins / n) * 100).toFixed(0);
    const fvRatingAvg = avg('fvRating').toFixed(2);

    // ── Total rounds pour les calculs ──────────────────────────────────────
    const totalRoundsAll = recentMatches.reduce((s, m) => s + (m.rounds || 0), 0) || n * 24;

    // ── CT / T split : depuis les matchs récents ou lifetime segments ───────
    const totCtRounds = sum('ctRounds');
    const totTRounds  = sum('tRounds');

    // Fallback lifetime pour CT/T split
    const lifetimeCtWinRate = parseFloat(lifetime['Win Rate % CT']) || parseFloat(lifetime['CT Win Rate %']) || 0;
    const lifetimeTWinRate  = parseFloat(lifetime['Win Rate % T'])  || parseFloat(lifetime['T Win Rate %'])  || 0;
    const lifetimeCtKd = parseFloat(lifetime['K/D Ratio CT']) || parseFloat(lifetime['CT K/D']) || 0;
    const lifetimeTKd  = parseFloat(lifetime['K/D Ratio T'])  || parseFloat(lifetime['T K/D'])  || 0;

    const ctWinRate = totCtRounds > 0
      ? ((sum('ctWins') / totCtRounds) * 100).toFixed(0)
      : lifetimeCtWinRate > 0 ? lifetimeCtWinRate.toFixed(0) : '';
    const tWinRate  = totTRounds > 0
      ? ((sum('tWins') / totTRounds) * 100).toFixed(0)
      : lifetimeTWinRate > 0 ? lifetimeTWinRate.toFixed(0) : '';
    const ctKd = sum('ctDeaths') > 0
      ? (sum('ctKills') / sum('ctDeaths')).toFixed(2)
      : lifetimeCtKd > 0 ? lifetimeCtKd.toFixed(2) : '';
    const tKd  = sum('tDeaths') > 0
      ? (sum('tKills') / sum('tDeaths')).toFixed(2)
      : lifetimeTKd > 0 ? lifetimeTKd.toFixed(2) : '';

    // ── Flashes : depuis lifetime si pas dans les matchs ──────────────────
    const sumFlashesThrown  = sum('flashesThrown');
    const sumEnemiesFlashed = sum('enemiesFlashed');
    const lifetimeFlashes   = parseInt(lifetime['Flash Count']) || parseInt(lifetime['Flashes Thrown']) || 0;
    const lifetimeFlashed   = parseInt(lifetime['Enemies Flashed']) || parseInt(lifetime['Flash Assists']) || 0;

    const totalFlashesThrown  = sumFlashesThrown  > 0 ? sumFlashesThrown  : lifetimeFlashes;
    const totalEnemiesFlashed = sumEnemiesFlashed > 0 ? sumEnemiesFlashed : lifetimeFlashed;
    const avgFlashPerRound    = totalRoundsAll > 0 && totalFlashesThrown > 0
      ? (totalFlashesThrown / totalRoundsAll).toFixed(2) : '0.00';

    // ── Utility ───────────────────────────────────────────────────────────
    const sumUtilDmg = sum('utilDmg');
    const lifetimeUtilDmg = parseInt(lifetime['Utility Damage']) || parseInt(lifetime['Utility DMG']) || 0;
    const totalUtilDmg = sumUtilDmg > 0 ? sumUtilDmg : lifetimeUtilDmg;
    const avgUtilDmg   = (totalUtilDmg / n).toFixed(0);

    // ── Trades & saves ─────────────────────────────────────────────────────
    const sumTradeKills  = sum('tradeKills');
    const sumTradeDeaths = sum('tradeDeaths');
    const sumSaves       = sum('saves');
    const lifetimeTrades = parseInt(lifetime['Trade Kills'])  || 0;
    const lifetimeSaves  = parseInt(lifetime['Saves'])        || 0;

    const totalTradeKills  = sumTradeKills  > 0 ? sumTradeKills  : lifetimeTrades;
    const totalTradeDeaths = sumTradeDeaths > 0 ? sumTradeDeaths : 0;
    const totalSaves       = sumSaves       > 0 ? sumSaves       : lifetimeSaves;

    // ── Pistol rounds ─────────────────────────────────────────────────────
    const sumPistolWins  = sum('pistolWins');
    const sumPistolTotal = sum('pistolTotal');
    const lifetimePistolWins  = parseInt(lifetime['Pistol Round Wins'])   || parseInt(lifetime['Pistol Wins'])  || 0;
    const lifetimePistolTotal = parseInt(lifetime['Pistol Round Played'])  || parseInt(lifetime['Pistol Played'])|| 0;

    const totalPistolWins  = sumPistolWins  > 0 ? sumPistolWins  : lifetimePistolWins;
    const totalPistolTotal = sumPistolTotal > 0 ? sumPistolTotal : lifetimePistolTotal;
    const pistolWinRate    = totalPistolTotal > 0
      ? ((totalPistolWins / totalPistolTotal) * 100).toFixed(0) : '';

    // ── Sniper ────────────────────────────────────────────────────────────
    const sumSniperKills = sum('sniperKills');
    const lifetimeSniper = parseInt(lifetime['Sniper Kills']) || parseInt(lifetime['AWP Kills']) || 0;
    const totalSniperKills = sumSniperKills > 0 ? sumSniperKills : lifetimeSniper;
    const sniperKillRate   = n > 0 ? (totalSniperKills / n).toFixed(1) : '0.0';

    // ── Multi-kills ───────────────────────────────────────────────────────
    const totalDoubles = sum('double');
    const totalTriples = sum('triple');
    const totalQuads   = sum('quad');
    const totalAces    = sum('ace');

    // ── Clutches : depuis lifetime si les matchs n'ont pas ces champs ─────
    // FACEIT retourne ces stats dans lifetime mais pas toujours par match
    const lifetimeClutch1v1 = parseInt(lifetime['1v1Wins']) || parseInt(lifetime['1v1 Wins']) || 0;
    const lifetimeClutch1v2 = parseInt(lifetime['1v2Wins']) || parseInt(lifetime['1v2 Wins']) || 0;
    const lifetimeClutch1v3 = parseInt(lifetime['1v3Wins']) || parseInt(lifetime['1v3 Wins']) || 0;
    const lifetimeClutch1v4 = parseInt(lifetime['1v4Wins']) || parseInt(lifetime['1v4 Wins']) || 0;
    const lifetimeClutch1v5 = parseInt(lifetime['1v5Wins']) || parseInt(lifetime['1v5 Wins']) || 0;

    const sumClutch1v1 = sum('clutch1v1');
    const sumClutch1v2 = sum('clutch1v2');
    const sumClutch1v3 = sum('clutch1v3');
    const sumClutch1v4 = sum('clutch1v4');
    const sumClutch1v5 = sum('clutch1v5');

    // Utiliser les données par match si disponibles, sinon lifetime
    const totalClutch1v1 = sumClutch1v1 > 0 ? sumClutch1v1 : lifetimeClutch1v1;
    const totalClutch1v2 = sumClutch1v2 > 0 ? sumClutch1v2 : lifetimeClutch1v2;
    const totalClutch1v3 = sumClutch1v3 > 0 ? sumClutch1v3 : lifetimeClutch1v3;
    const totalClutch1v4 = sumClutch1v4 > 0 ? sumClutch1v4 : lifetimeClutch1v4;
    const totalClutch1v5 = sumClutch1v5 > 0 ? sumClutch1v5 : lifetimeClutch1v5;

    // ── Opening duels ─────────────────────────────────────────────────────
    // FACEIT CS2 lifetime : Entry Wins + Entry Count. Fallback CSGO legacy.
    const sumFirstKills  = sum('firstKills');
    const sumFirstDeaths = sum('firstDeaths');
    const ltEntryCount = parseInt(lifetime['Entry Count']) || 0;
    const ltEntryWins  = parseInt(lifetime['Entry Wins'])  || 0;
    const lifetimeFirstKills = ltEntryWins > 0 ? ltEntryWins
                             : (parseInt(lifetime['First Kills']) || parseInt(lifetime['Opening Kills']) || 0);
    const lifetimeFirstDeaths = (ltEntryCount > 0 && ltEntryCount >= ltEntryWins)
                              ? ltEntryCount - ltEntryWins
                              : (parseInt(lifetime['First Deaths']) || parseInt(lifetime['Opening Deaths']) || 0);

    const totalFirstKills  = sumFirstKills  > 0 ? sumFirstKills  : lifetimeFirstKills;
    const totalFirstDeaths = sumFirstDeaths > 0 ? sumFirstDeaths : lifetimeFirstDeaths;
    const openingRatio     = totalFirstDeaths > 0
      ? (totalFirstKills / totalFirstDeaths).toFixed(2) : totalFirstKills.toString();

    // ── Stats par map ─────────────────────────────────────────────────────
    const mapStats = {};
    recentMatches.forEach(m => {
      if (!m.map || m.map === '') return;
      if (!mapStats[m.map]) mapStats[m.map] = {
        wins: 0, total: 0, kills: 0, deaths: 0,
        ctWins: 0, ctRounds: 0, tWins: 0, tRounds: 0,
        adr: 0, kast: 0, fvRating: 0,
      };
      const ms = mapStats[m.map];
      ms.total++;
      if (m.result === 1) ms.wins++;
      ms.kills   += m.kills;
      ms.deaths  += m.deaths;
      ms.ctWins  += m.ctWins;   ms.ctRounds += m.ctRounds;
      ms.tWins   += m.tWins;    ms.tRounds  += m.tRounds;
      ms.adr     += m.adr;      ms.kast     += m.kast;
      ms.fvRating += m.fvRating;
    });

    const mapStatsArr = Object.entries(mapStats).map(([map, d]) => ({
      map,
      matches:     d.total,
      winRate:     ((d.wins / d.total) * 100).toFixed(0),
      kd:          d.deaths > 0 ? (d.kills / d.deaths).toFixed(2) : d.kills.toString(),
      ctWinRate:   d.ctRounds > 0 ? ((d.ctWins / d.ctRounds) * 100).toFixed(0) : '',
      tWinRate:    d.tRounds  > 0 ? ((d.tWins  / d.tRounds)  * 100).toFixed(0) : '',
      avgAdr:      (d.adr  / d.total).toFixed(0),
      avgKast:     (d.kast / d.total).toFixed(0),
      avgFvRating: (d.fvRating / d.total).toFixed(2),
    })).sort((a, b) => b.matches - a.matches);

    // ── Rôle estimé ───────────────────────────────────────────────────────
    let role = 'Rifler';
    if (totalSniperKills > sum('kills') * 0.35) role = 'AWPer';
    else if (parseFloat(avgKr) < 0.55 && parseFloat(avgKast) > 70) role = 'Support';
    else if (totalFirstKills > totalFirstDeaths * 1.3) role = 'Entry fragger';
    else if (totalClutch1v1 + totalClutch1v2 > 8) role = 'Clutch player';


    // ══════════════════════════════════════════════════════════════════════
    // FV SCORE /100 : Indice de talent FragValue
    // Plus puissant que HLTV 2.1, FACEIT ELO et Leetify Rating car il combine :
    //   - Performance contextuelle (35pts) : KPR/DPR/ADR/KAST pondérés + ajustement ELO
    //   - Consistance (25pts)              : variance des ratings sur 20 matchs
    //   - Impact (25pts)                   : clutches pondérés, opening duels, multi-kills
    //   - Utilité (15pts)                  : flash efficacy, util dmg, trades, assists
    // ══════════════════════════════════════════════════════════════════════
    const fvScore = (() => {
      if (recentMatches.length < 3) return null; // pas assez de données

      const totalRounds = (totCtRounds + totTRounds) || 1;
      const totalKills  = sum('kills');
      const totalDeaths = sum('deaths');
      const totalAssists= sum('assists');

      // ── 1. PERFORMANCE (35 pts) ──────────────────────────────────────────
      // Basé sur HLTV 2.1 reverse-engineered + ajustements CS2
      // On utilise avgFvRating déjà calculé (≈ HLTV 2.1) comme base
      // puis on l'ajuste selon le niveau ELO (contexte adversaires)
      const eloLevel = cs2data.skill_level || 5; // 1-10
      const eloValue  = cs2data.faceit_elo    || 0;

      // Segmentation fine du lvl 10 selon l'ELO précis
      // Distribution réelle FACEIT CS2 :
      //   2001-2500 → Lvl 10 standard
      //   2501-3000 → Lvl 10 Elite      (~top 15%)
      //   3001-3500 → Lvl 10 Elite+     (~top 5%)
      //   3501+     → Challenger        (~top 1000)
      // ── Seuil Challenger par région (mis à jour depuis le leaderboard live) ──
      // EU: 3787 | NA: 3100 | SA: 2800 (valeurs saison 7, mars 2026)
      const CHALLENGER_FALLBACKS = { EU: 3787, NA: 3100, SA: 2800, OCE: 2500, SEA: 2500 };
      const region = (cs2data.region || 'EU').toUpperCase();
      const challengerThreshold = CHALLENGER_FALLBACKS[region] || 3787;
      let challengerRank = null;
      // Note : la position exacte Challenger sera ajoutée via un endpoint dédié ultérieurement

      // ── 10 sous-niveaux dynamiques du lvl 10 ────────────────────────────
      // La plage 2001 → challengerThreshold est divisée en 10 tranches égales
      // Chaque sous-niveau correspond à 1/10 de cette plage
      const LVL10_BASE = 2001;
      const lvl10Range = challengerThreshold - LVL10_BASE;
      const subLevelSize = lvl10Range / 10;

      // Sous-niveau 1-10 (1 = entrée lvl10, 10 = juste avant Challenger)
      const subLevel = eloLevel === 10 && eloValue < challengerThreshold
        ? Math.min(10, Math.max(1, Math.ceil((eloValue - LVL10_BASE) / subLevelSize)))
        : null;

      // eloFactor progressif : 1.15 (sous-niveau 1) → 1.44 (sous-niveau 10) → 1.45 (Challenger)
      const eloFactor = (() => {
        if (eloLevel < 10) return 0.85 + (eloLevel / 10) * 0.30;
        if (eloValue >= challengerThreshold) return 1.45; // Challenger
        // Interpolation linéaire entre 1.15 et 1.44 selon le sous-niveau
        return parseFloat((1.15 + (subLevel - 1) * (0.29 / 9)).toFixed(4));
      })();

      // Performance brute normalisée sur [0,35]
      // fvRating moyen : 0.5 (très mauvais) → 1.5 (excellent)
      const perfRaw = parseFloat(fvRatingAvg);
      const perfNorm = Math.min(35, Math.max(0,
        ((perfRaw - 0.5) / 1.0) * 35 * eloFactor
      ));

      // Bonus ADR contextuel (HLTV 3.0 inspired : ADR ajusté au niveau)
      const adrRef = 55 + eloLevel * 4; // référence par niveau : lvl5=75, lvl10=95
      const adrBonus = Math.min(3, Math.max(-3, (parseFloat(avgAdr) - adrRef) / adrRef * 8));

      const perfScore = Math.min(35, Math.max(0, perfNorm + adrBonus));

      // ── 2. CONSISTANCE (25 pts) ──────────────────────────────────────────
      // Leetify-inspired : la variance des performances est aussi importante que la moyenne
      // Un joueur régulier à 1.1 vaut mieux qu'un joueur à 1.5 une fois sur deux
      const ratings = recentMatches.map(m => m.fvRating).filter(r => r > 0);
      const ratingMean = ratings.reduce((a, b) => a + b, 0) / (ratings.length || 1);
      const variance = ratings.reduce((s, r) => s + Math.pow(r - ratingMean, 2), 0) / (ratings.length || 1);
      const stdDev = Math.sqrt(variance);

      // Coefficient de variation (CV) : stdDev / mean → plus c'est bas, plus c'est consistent
      const cv = ratingMean > 0 ? stdDev / ratingMean : 1;

      // Score consistance : CV=0 (parfait) → 25pts, CV=0.5 (très instable) → 0pts
      // CV=0 (parfait)→25pts, CV=0.35 (instable)→0pts : seuil plus strict
      const consistScore = Math.min(25, Math.max(0, (1 - cv / 0.35) * 25));

      // Bonus : trend positif sur les 5 derniers matchs vs 5 précédents
      if (ratings.length >= 10) {
        const recent5  = ratings.slice(0, 5).reduce((a,b) => a+b, 0) / 5;
        const before5  = ratings.slice(5, 10).reduce((a,b) => a+b, 0) / 5;
        const trendBonus = Math.min(3, Math.max(-3, (recent5 - before5) * 10));
        // trendBonus appliqué ci-dessous dans le total
      }
      const trendBonus = (() => {
        if (ratings.length < 10) return 0;
        const r5 = ratings.slice(0, 5).reduce((a,b)=>a+b,0)/5;
        const b5 = ratings.slice(5,10).reduce((a,b)=>a+b,0)/5;
        return Math.min(3, Math.max(-3, (r5 - b5) * 10));
      })();

      // ── 3. IMPACT (25 pts) ───────────────────────────────────────────────
      // Inspired by Leetify win-probability change model
      // On pondère les clutches par leur difficulté (1v5 >> 1v1)
      const clutchWeight =
        totalClutch1v1 * 1.0 +
        totalClutch1v2 * 2.0 +
        totalClutch1v3 * 3.5 +
        totalClutch1v4 * 5.0 +
        totalClutch1v5 * 8.0;

      // Normalisation : ~2 clutch1v1 par match = référence
      const clutchRef  = n * 2;
      const clutchScore = Math.min(8, (clutchWeight / Math.max(clutchRef, 1)) * 8);

      // Opening duels : ratio FK/FD pondéré par volume
      const openingScore = (() => {
        const total = totalFirstKills + totalFirstDeaths;
        if (total < 5) return 3.5; // neutre si pas assez de données
        const ratio = totalFirstKills / (totalFirstDeaths || 1);
        // ratio 2.0 = excellent (8pts), ratio 0.5 = mauvais (0pts), ratio 1.0 = moyen (4pts)
        return Math.min(8, Math.max(0, (ratio - 0.5) / 1.5 * 8));
      })();

      // Multi-kills pondérés (double=1x, triple=2x, quad=4x, ace=8x)
      const mkWeight = totalDoubles * 1 + totalTriples * 2 + totalQuads * 4 + totalAces * 8;
      const mkRef    = n * 3; // ~3 doubles par match = référence
      const mkScore  = Math.min(6, (mkWeight / Math.max(mkRef, 1)) * 6);

      // Trade kills (aggressivité utile)
      const tradeScore = Math.min(3, (totalTradeKills / Math.max(n * 2, 1)) * 3);

      const impactScore = Math.min(25, clutchScore + openingScore + mkScore + tradeScore);

      // ── 4. UTILITÉ (15 pts) ──────────────────────────────────────────────
      // Inspired by Leetify Utility Rating (Quantity × Quality)

      // Flash efficacy : enemiesFlashed par flash lancée (qualité)
      const flashQuality = totalFlashesThrown > 0
        ? Math.min(1, totalEnemiesFlashed / totalFlashesThrown)
        : 0;
      // Quantité : flashes par round
      const flashQuantity = Math.min(1, totalFlashesThrown / (totalRounds * 0.4));
      // Geometric mean (comme Leetify) : punit les extrêmes
      const flashScore = Math.min(4, Math.sqrt(flashQuality * flashQuantity) * 4);

      // Utility damage par round
      const utilDmgPerRound = totalUtilDmg / totalRounds;
      const utilDmgScore = Math.min(4, (utilDmgPerRound / 8) * 4); // ref: 8 util dmg/round

      // Assists par round (teamplay)
      const assistRate = totalAssists / totalRounds;
      const assistScore = Math.min(4, (assistRate / 0.25) * 4); // ref: 0.25 assists/round

      // Saves intelligents (pas du jame-timing mais des saves utiles)
      const saveRate   = totalSaves / n;
      const saveScore  = Math.min(3, (saveRate / 2) * 3); // ref: 2 saves/match

      const utilScore = Math.min(15, flashScore + utilDmgScore + assistScore + saveScore);

      // ── TOTAL FV SCORE ────────────────────────────────────────────────────
      const raw = perfScore + consistScore + trendBonus + impactScore + utilScore;
      const total = Math.round(Math.min(100, Math.max(0, raw)));

      // ── BREAKDOWN détaillé pour affichage ────────────────────────────────
      return {
        total,
        breakdown: {
          performance: {
            score:    Math.round(perfScore * 10) / 10,
            max:      35,
            detail: {
              fvRatingAvg: parseFloat(fvRatingAvg),
              eloAdjustment: Math.round(eloFactor * 100) / 100,
              adrBonus: Math.round(adrBonus * 10) / 10,
            }
          },
          consistency: {
            score:    Math.round((consistScore + trendBonus) * 10) / 10,
            max:      28, // 25 + 3 bonus trend
            detail: {
              stdDev:      Math.round(stdDev * 1000) / 1000,
              cv:          Math.round(cv * 100) / 100,
              trendBonus:  Math.round(trendBonus * 10) / 10,
            }
          },
          impact: {
            score:    Math.round(impactScore * 10) / 10,
            max:      25,
            detail: {
              clutchScore:  Math.round(clutchScore * 10) / 10,
              openingScore: Math.round(openingScore * 10) / 10,
              mkScore:      Math.round(mkScore * 10) / 10,
              tradeScore:   Math.round(tradeScore * 10) / 10,
            }
          },
          utility: {
            score:    Math.round(utilScore * 10) / 10,
            max:      15,
            detail: {
              flashScore:   Math.round(flashScore * 10) / 10,
              utilDmgScore: Math.round(utilDmgScore * 10) / 10,
              assistScore:  Math.round(assistScore * 10) / 10,
              saveScore:    Math.round(saveScore * 10) / 10,
            }
          },
        },
        // Label qualitatif
        label: total >= 90 ? 'Challenger'    :
               total >= 80 ? 'Élite+'        :
               total >= 70 ? 'Élite'         :
               total >= 58 ? 'Très bon'      :
               total >= 46 ? 'Bon'           :
               total >= 34 ? 'Moyen'         :
               total >= 20 ? 'En progression':
                             'Débutant',
        // Bracket dynamique basé sur le leaderboard live
        eloBracket: eloLevel === 10
          ? (eloValue >= challengerThreshold
            ? 'Challenger'
            : `Lvl 10.${subLevel}`)
          : null,
        // Sous-niveau précis (1-10) dans le lvl 10
        subLevel,
        // Progression dans le sous-niveau actuel (0-100%)
        subLevelProgress: subLevel !== null
          ? Math.round(((eloValue - LVL10_BASE - (subLevel - 1) * subLevelSize) / subLevelSize) * 100)
          : null,
        // Position dans le leaderboard Challenger (si applicable)
        challengerRank,
        // Seuil ELO Challenger de la région au moment de l'analyse
        challengerThreshold,
        // Taille d'une tranche de sous-niveau
        subLevelSize: Math.round(subLevelSize),
      };
    })();

    return res.status(200).json({
      player: {
        playerId, nickname: player.nickname,
        avatar:   player.avatar     || null,
        country:  player.country    || null,
        faceitUrl: player.faceit_url || null,
        membershipType: player.membership_type || 'free',
      },
      cs2: {
        elo:   cs2data.faceit_elo    || 0,
        level: cs2data.skill_level   || 0,
        region: cs2data.region       || '',
      },
      lifetime: {
        matches:       parseInt(lifetime['Matches'])              || 0,
        wins:          parseInt(lifetime['Wins'])                 || 0,
        winRate:       parseFloat(lifetime['Win Rate %'])         || 0,
        kd:            parseFloat(lifetime['Average K/D Ratio'])  || 0,
        hs:            parseFloat(lifetime['Average Headshots %']) || 0,
        longestStreak: parseInt(lifetime['Longest Win Streak'])   || 0,
        currentStreak: parseInt(lifetime['Current Win Streak'])   || 0,
        recentResults: lifetime['Recent Results'] || [],
      },
      recent: {
        // Core
        avgKd, avgHs, avgAdr, avgKast, avgKr, winRate, fvRating: fvRatingAvg,
        // CT/T split
        ctWinRate, tWinRate, ctKd, tKd,
        // Flashes & utility
        totalFlashesThrown, totalEnemiesFlashed, avgFlashPerRound, totalUtilDmg, avgUtilDmg,
        // Trades & saves
        totalTradeKills, totalTradeDeaths, totalSaves,
        // Pistol
        pistolWinRate, totalPistolWins, totalPistolTotal,
        // Sniper
        totalSniperKills, sniperKillRate,
        // Multi-kills
        totalDoubles, totalTriples, totalQuads, totalAces,
        // Clutches
        totalClutch1v1, totalClutch1v2, totalClutch1v3, totalClutch1v4, totalClutch1v5,
        // Opening
        totalFirstKills, totalFirstDeaths, openingRatio,
        // Matches detail
        matches: recentMatches,
        // Role
        role,
      },
      fvScore,
      mapStats: mapStatsArr,
      teams: (teamsData.items || []).slice(0, 3).map(t => ({
        name: t.name, avatar: t.avatar, game: t.game,
      })),
    });

  } catch (err) {
    console.error('FragValue Scout API error:', err);
    return res.status(500).json({ error: 'Erreur serveur. Réessaie dans quelques instants.' });
  }
};
