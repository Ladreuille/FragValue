// api/submit-demo-url.js
//
// Called by the FragValue browser extension after it has extracted a fresh
// presigned FACEIT demo URL from api.faceit.com (using the user's own
// session cookies). We upsert the match row in Supabase, persist the URL,
// mark it as parsing, and fire the Railway parser with the override URL so
// the parser does NOT re-fetch the (dead) public Data API demo_url.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PARSER_URL = process.env.PARSER_URL || 'https://fragvalue-demo-parser-production.up.railway.app';
const PARSER_SECRET = process.env.FACEIT_WEBHOOK_SECRET || '';

// Defensive whitelist: we only accept URLs on FACEIT's known demo hosts or
// their Backblaze B2 successor. Stops the extension from being used as an
// open fetch-and-process relay.
const ALLOWED_HOST_PATTERNS = [
  /(^|\.)faceit-cdn\.net$/i,
  /(^|\.)backblazeb2\.com$/i,
  /(^|\.)faceit\.com$/i,
];

function isAllowedDemoHost(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOST_PATTERNS.some(rx => rx.test(u.hostname));
  } catch (_) {
    return false;
  }
}

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

    const { matchId, demoUrl, map, finishedAt } = req.body || {};
    if (!matchId || typeof matchId !== 'string') {
      return res.status(400).json({ error: 'matchId required' });
    }
    if (!demoUrl || typeof demoUrl !== 'string') {
      return res.status(400).json({ error: 'demoUrl required' });
    }
    if (!isAllowedDemoHost(demoUrl)) {
      return res.status(400).json({ error: 'demoUrl host not allowed' });
    }

    // Upsert the match row. If it already exists (e.g. freshly pushed by
    // /api/import-history moments ago), we keep the user_id + map and just
    // overwrite status + demo_url + error_message. The service key bypasses
    // RLS, so this works even for rows created by a background webhook.
    const upsertPayload = {
      id: matchId,
      faceit_match_id: matchId,
      user_id: user.id,
      status: 'parsing',
      demo_url: demoUrl,
      error_message: null,
    };
    if (map) upsertPayload.map = map;

    const { error: upsertErr } = await supabase
      .from('matches')
      .upsert(upsertPayload, { onConflict: 'faceit_match_id' });

    if (upsertErr) {
      console.error('submit-demo-url upsert error:', upsertErr);
      return res.status(500).json({ error: 'DB upsert failed' });
    }

    // Fire Railway parser with the overriding demoUrl so it skips the dead
    // public Data API demo_url fetch.
    try {
      await fetch(`${PARSER_URL}/process-match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PARSER_SECRET}`,
        },
        body: JSON.stringify({ matchId, demoUrl }),
      });
    } catch (err) {
      console.error('parser fire error:', err.message);
      // Do not fail the request — the row is already in parsing state and
      // the user can retry via the UI.
    }

    return res.status(200).json({ ok: true, matchId, queued: true });
  } catch (err) {
    console.error('submit-demo-url error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
