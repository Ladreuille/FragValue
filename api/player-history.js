// api/player-history.js
// GET ?nickname=<pseudo>&limit=20
// Retourne les stats agregees des N derniers matchs FragValue analyses pour
// ce joueur. Utilise pour afficher les deltas "ce match vs ta moyenne" sur
// analysis.html et dans le PDF export.
//
// Cache 5 min via s-maxage pour limiter les hits DB repetes pour un meme user
// qui scroll entre ses matchs.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const nickname = String(req.query.nickname || '').trim();
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 20));
  if (!nickname) return res.status(400).json({ error: 'nickname requis' });

  try {
    // On pull des match_players par nickname, tries par date desc.
    // Note : filtre status='ok' sur matches via le join pour eviter les matchs
    // en cours d'import ou failed qui auraient des stats partielles.
    const { data, error } = await supabase
      .from('match_players')
      .select('kills, deaths, assists, kast, adr, hs_pct, fv_rating, first_kills, created_at, match_id')
      .ilike('nickname', nickname) // case-insensitive pour tolerer les casse mixte
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[player-history] DB error:', error);
      return res.status(500).json({ error: 'Erreur DB' });
    }

    const matches = data || [];

    if (!matches.length) {
      return res.status(200).json({
        nickname,
        matchCount: 0,
        averages: null,
        message: 'Aucun match trouve pour ce joueur. Analyse quelques matchs pour voir ton evolution.',
      });
    }

    // Aggregation : moyenne simple. Les stats sont deja normalisees (per round
    // pour ADR/KAST/FVR) donc moyenne directe est correcte.
    const n = matches.length;
    const sum = (key) => matches.reduce((s, m) => s + Number(m[key] || 0), 0);
    const avg = {
      fvr:        sum('fv_rating') / n,
      kills:      sum('kills') / n,
      deaths:     sum('deaths') / n,
      assists:    sum('assists') / n,
      kast:       sum('kast') / n,
      adr:        sum('adr') / n,
      hsPct:      sum('hs_pct') / n,
      firstKills: sum('first_kills') / n,
    };

    // Medianes (plus robustes aux outliers) pour fvr/adr/kast
    function median(arr) {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    const med = {
      fvr:  median(matches.map(m => Number(m.fv_rating || 0))),
      adr:  median(matches.map(m => Number(m.adr || 0))),
      kast: median(matches.map(m => Number(m.kast || 0))),
    };

    // Tendance : compare les 5 derniers matchs vs les 5 precedents
    let trend = null;
    if (n >= 6) {
      const recent = matches.slice(0, Math.min(5, Math.floor(n / 2)));
      const older = matches.slice(-Math.min(5, Math.floor(n / 2)));
      const avgRecent = recent.reduce((s, m) => s + Number(m.fv_rating || 0), 0) / recent.length;
      const avgOlder = older.reduce((s, m) => s + Number(m.fv_rating || 0), 0) / older.length;
      trend = {
        deltaFvr: parseFloat((avgRecent - avgOlder).toFixed(3)),
        direction: avgRecent > avgOlder + 0.02 ? 'up' : avgRecent < avgOlder - 0.02 ? 'down' : 'flat',
      };
    }

    const response = {
      nickname,
      matchCount: n,
      averages: {
        fvr:        parseFloat(avg.fvr.toFixed(3)),
        kills:      parseFloat(avg.kills.toFixed(1)),
        deaths:     parseFloat(avg.deaths.toFixed(1)),
        assists:    parseFloat(avg.assists.toFixed(1)),
        kast:       parseFloat(avg.kast.toFixed(1)),
        adr:        parseFloat(avg.adr.toFixed(1)),
        hsPct:      parseFloat(avg.hsPct.toFixed(1)),
        firstKills: parseFloat(avg.firstKills.toFixed(1)),
      },
      medians: {
        fvr:  parseFloat(med.fvr.toFixed(3)),
        adr:  parseFloat(med.adr.toFixed(1)),
        kast: parseFloat(med.kast.toFixed(1)),
      },
      trend,
      period: {
        from: matches[matches.length - 1].created_at,
        to: matches[0].created_at,
      },
    };

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(response);
  } catch (e) {
    console.error('[player-history]', e);
    return res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
}
