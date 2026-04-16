// api/retry-match.js
// Repasse un seul match en pending et redeclenche le parser Railway
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

    const { matchId } = req.body || {};
    if (!matchId) return res.status(400).json({ error: 'matchId required' });

    // Reset en pending (RLS bypass via service key)
    await supabase.from('matches')
      .update({ status: 'pending', parsed_at: null })
      .eq('faceit_match_id', matchId)
      .eq('user_id', user.id);

    // Fire and forget vers le parser Railway
    try {
      await fetch(`${PARSER_URL}/process-match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PARSER_SECRET}`,
        },
        body: JSON.stringify({ matchId }),
      });
    } catch (_) {}

    return res.status(200).json({ ok: true, matchId });
  } catch (err) {
    console.error('retry-match error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
