// api/matches.js
// GET : liste des matches FragValue de l'utilisateur
// GET ?id=... : detail d'un match + players
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://frag-value.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non authentifie' });

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token invalide' });

    const matchId = req.query.id;

    // Detail d'un match specifique
    if (matchId) {
      const { data: match, error: mErr } = await supabase
        .from('matches')
        .select('*')
        .eq('faceit_match_id', matchId)
        .single();
      if (mErr || !match) return res.status(404).json({ error: 'Match introuvable' });

      const { data: players } = await supabase
        .from('match_players')
        .select('*')
        .eq('match_id', matchId)
        .order('fv_rating', { ascending: false });

      return res.status(200).json({ match, players: players || [] });
    }

    // Liste des matches du user — union de deux sources :
    //  1) matches.user_id (rempli des l'import, couvre pending/parsing/failed)
    //  2) match_players.user_id (rempli apres parsing, couvre les matchs co-joues
    //     par d'autres users FragValue ou importes anciennement)
    const [directRes, playerRes] = await Promise.all([
      supabase
        .from('matches')
        .select('id, faceit_match_id, map, score_ct, score_t, winner, rounds, status, parsed_at, created_at, error_message')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('match_players')
        .select('match_id')
        .eq('user_id', user.id),
    ]);

    const directMatches = directRes.data || [];
    const playerMatchIds = [...new Set((playerRes.data || []).map(p => p.match_id))];
    const alreadyIncluded = new Set(directMatches.map(m => m.faceit_match_id));
    const missingIds = playerMatchIds.filter(id => !alreadyIncluded.has(id));

    let extraMatches = [];
    if (missingIds.length) {
      const { data } = await supabase
        .from('matches')
        .select('id, faceit_match_id, map, score_ct, score_t, winner, rounds, status, parsed_at, created_at, error_message')
        .in('faceit_match_id', missingIds)
        .limit(50);
      extraMatches = data || [];
    }

    const merged = [...directMatches, ...extraMatches]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50);

    return res.status(200).json({ matches: merged });
  } catch (err) {
    console.error('matches error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
