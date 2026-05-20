// api/account-progress.js · FragValue
//
// GET /api/account-progress
//
// Retourne les donnees de progression personnalisees pour l'user :
//   - top_priorities  : 3 axes prioritaires du dernier diagnostic Coach IA
//   - streak_days     : nombre de jours consecutifs avec au moins 1 demo analysee
//   - streak_record   : record personnel de streak
//   - next_milestone  : prochain badge a debloquer (7j, 14j, 30j, 60j)
//   - recent_axis_scores : top axis scores du dernier diagnostic (pour mini-chart)
//
// Auth : JWT Supabase requis.
// Cache : 5 min (les donnees bougent peu).

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 90, 180, 365];

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

    // Fetch parallel : latest diagnostic + recent demos for streak
    const [diagRes, demosRes] = await Promise.all([
      sb.from('diagnostic_history')
        .select('top_priorities, axis_scores, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Pour calculer la streak, on remonte 180j en arriere max
      sb.from('demos')
        .select('analysed_at')
        .eq('user_id', user.id)
        .gte('analysed_at', new Date(Date.now() - 180 * 86400 * 1000).toISOString())
        .order('analysed_at', { ascending: false }),
    ]);

    // ── Streak calculation ──────────────────────────────────────────────
    // On groupe les demos par jour (UTC) et on compte consecutifs jusqu'a
    // aujourd'hui ou hier (tolerance d'1 jour pour ne pas casser la streak
    // si l'user n'a pas encore joue aujourd'hui).
    const demoDays = new Set();
    for (const d of (demosRes.data || [])) {
      const day = (d.analysed_at || '').slice(0, 10);  // ISO YYYY-MM-DD
      if (day) demoDays.add(day);
    }

    let streakDays = 0;
    const today = new Date();
    const todayISO = today.toISOString().slice(0, 10);
    const yesterdayISO = new Date(today.getTime() - 86400 * 1000).toISOString().slice(0, 10);

    // Si on a demo aujourd'hui ou hier, on commence a compter
    let cursorDate;
    if (demoDays.has(todayISO)) cursorDate = today;
    else if (demoDays.has(yesterdayISO)) cursorDate = new Date(today.getTime() - 86400 * 1000);
    else cursorDate = null;

    while (cursorDate) {
      const iso = cursorDate.toISOString().slice(0, 10);
      if (demoDays.has(iso)) {
        streakDays++;
        cursorDate = new Date(cursorDate.getTime() - 86400 * 1000);
      } else {
        break;
      }
    }

    // Record streak : on parcourt l'historique pour le maximum
    let bestStreak = 0;
    let currentSequence = 0;
    let prevDay = null;
    const sortedDays = Array.from(demoDays).sort();
    for (const day of sortedDays) {
      if (prevDay === null) {
        currentSequence = 1;
      } else {
        const diff = (new Date(day).getTime() - new Date(prevDay).getTime()) / 86400000;
        if (diff === 1) currentSequence++;
        else currentSequence = 1;
      }
      if (currentSequence > bestStreak) bestStreak = currentSequence;
      prevDay = day;
    }
    if (streakDays > bestStreak) bestStreak = streakDays;

    // Next milestone (>= streak courant)
    let nextMilestone = null;
    for (const m of STREAK_MILESTONES) {
      if (streakDays < m) { nextMilestone = m; break; }
    }

    // ── Top priorities from latest diagnostic ───────────────────────────
    const latestDiag = diagRes.data;
    let topPriorities = [];
    let axisScores = {};
    let diagAge = null;
    if (latestDiag) {
      topPriorities = Array.isArray(latestDiag.top_priorities) ? latestDiag.top_priorities : [];
      axisScores = latestDiag.axis_scores || {};
      diagAge = latestDiag.created_at;
    }

    return res.status(200).json({
      streak_days:     streakDays,
      streak_record:   bestStreak,
      next_milestone:  nextMilestone,
      top_priorities:  topPriorities.slice(0, 3),
      axis_scores:     axisScores,
      diagnostic_age:  diagAge,
      has_diagnostic:  !!latestDiag,
    });
  } catch (err) {
    console.error('[account-progress] error:', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
