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

// Defensive whitelist: only accept URLs on hosts we know FACEIT uses for
// demo distribution. Stops the extension from being used as an open
// fetch-and-process relay. Kept broad enough to survive FACEIT swapping
// CDN backends (observed: Backblaze direct, Backblaze-behind-CDN, AWS S3,
// democracy.faceit.com intermediary).
const ALLOWED_HOST_PATTERNS = [
  /(^|\.)faceit-cdn\.net$/i,
  /(^|\.)faceit\.com$/i,
  /(^|\.)backblazeb2\.com$/i,
  /(^|\.)backblaze\.com$/i,
  /(^|\.)amazonaws\.com$/i,
  /(^|\.)cloudfront\.net$/i,
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

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default async function handler(req, res) {
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
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token invalide' });

    const { matchId, demoUrl, map, finishedAt, error: failureReason } = req.body || {};
    if (!matchId || typeof matchId !== 'string') {
      return res.status(400).json({ error: 'matchId required' });
    }

    // Failure fast-path: the extension hit a dead end while resolving the
    // demo URL (most commonly FACEIT retention purge after ~30 days, signal
    // "err_nf0 file not found"). Mark the row as failed with a friendly
    // error message so the UI stops showing it as pending forever.
    if (failureReason && !demoUrl) {
      const { error: upsertErr } = await supabase
        .from('matches')
        .upsert({
          id: matchId,
          faceit_match_id: matchId,
          user_id: user.id,
          status: 'failed',
          error_message: String(failureReason).slice(0, 500),
        }, { onConflict: 'faceit_match_id' });
      if (upsertErr) {
        console.error('submit-demo-url failure upsert error:', upsertErr);
        return res.status(500).json({ error: 'DB upsert failed' });
      }
      return res.status(200).json({ ok: true, matchId, failed: true });
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
      // Do not fail the request - the row is already in parsing state and
      // the user can retry via the UI.
    }

    return res.status(200).json({ ok: true, matchId, queued: true });
  } catch (err) {
    console.error('submit-demo-url error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
