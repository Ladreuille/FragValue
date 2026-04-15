// api/import-history.js
// Importe les 20 derniers matchs FACEIT du user et lance le parsing parser Railway
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const PARSER_URL = process.env.PARSER_URL || 'https://fragvalue-demo-parser-production.up.railway.app';
const PARSER_SECRET = process.env.FACEIT_WEBHOOK_SECRET || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://frag-value.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non authentifie' });

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token invalide' });

    // Recuperer le profil pour avoir faceit_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('faceit_id, faceit_nickname')
      .eq('id', user.id)
      .single();

    if (!profile?.faceit_id && !profile?.faceit_nickname) {
      return res.status(400).json({ error: 'FACEIT non lie a ce compte' });
    }

    if (!FACEIT_API_KEY) {
      return res.status(503).json({ error: 'FACEIT_API_KEY non configure' });
    }

    // Resoudre faceit_id a la volee via le nickname si manquant (legacy profils
    // crees avant qu'on stocke l'id) puis persister pour les prochains imports
    let faceitId = profile.faceit_id;
    if (!faceitId && profile.faceit_nickname) {
      const lookupUrl = `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(profile.faceit_nickname)}&game=cs2`;
      const lookupRes = await fetch(lookupUrl, {
        headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
      });
      if (!lookupRes.ok) {
        return res.status(502).json({ error: 'FACEIT player lookup failed' });
      }
      const lookup = await lookupRes.json();
      faceitId = lookup.player_id || lookup.id || null;
      if (!faceitId) {
        return res.status(404).json({ error: 'Joueur FACEIT introuvable' });
      }
      await supabase.from('profiles').update({
        faceit_id: faceitId,
        faceit_elo: lookup.games?.cs2?.faceit_elo || null,
        faceit_level: lookup.games?.cs2?.skill_level || null,
      }).eq('id', user.id);
    }

    // Fetch 20 derniers matchs CS2
    const histUrl = `https://open.faceit.com/data/v4/players/${faceitId}/history?game=cs2&offset=0&limit=20`;
    const histRes = await fetch(histUrl, {
      headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
    });
    if (!histRes.ok) {
      return res.status(histRes.status).json({ error: 'FACEIT history error' });
    }
    const history = await histRes.json();
    const items = history.items || [];

    // Inserer les matches en pending et lancer le parse pour chacun
    const imported = [];
    for (const m of items) {
      const matchId = m.match_id;
      if (!matchId) continue;

      // Skip si deja parse
      const { data: existing } = await supabase
        .from('matches')
        .select('faceit_match_id, status')
        .eq('faceit_match_id', matchId)
        .single();

      if (existing?.status === 'parsed') {
        imported.push({ matchId, status: 'already_parsed' });
        continue;
      }

      // Insert en pending
      await supabase.from('matches').upsert({
        id: matchId,
        faceit_match_id: matchId,
        user_id: user.id,
        map: m.i1 || null,
        status: existing?.status || 'pending',
      }, { onConflict: 'faceit_match_id' });

      // Declencher le parsing cote Railway (fire and forget)
      try {
        await fetch(`${PARSER_URL}/process-match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${PARSER_SECRET}`,
          },
          body: JSON.stringify({ matchId }),
        });
        imported.push({ matchId, status: 'queued' });
      } catch (e) {
        imported.push({ matchId, status: 'parser_error' });
      }
    }

    return res.status(200).json({
      imported: imported.length,
      matches: imported,
    });
  } catch (err) {
    console.error('import-history error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
