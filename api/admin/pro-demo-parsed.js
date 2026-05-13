// api/admin/pro-demo-parsed.js · FragValue · Option B Phase 5
//
// Callback endpoint que le parser Railway hit apres avoir parse une demo.
// Update pro_demos.status='parsed' + event_count + timestamps.
//
// Authentification : Bearer PARSER_SECRET (meme secret que le call sortant
// Vercel → Railway). Garantit que seul notre parser peut hitter cet endpoint.
//
// Body attendu :
//   {
//     "proMatchMapId": "uuid",
//     "eventCount": 1543,
//     "status": "parsed"  // ou "failed" avec errorMessage
//     "errorMessage": "..."  // optionnel si status=failed
//     "parserVersion": "v0.4.2"  // optionnel
//     "tickRate": 64  // optionnel
//   }
//
// Response : 200 ok ou 4xx/5xx.

const { createClient } = require('@supabase/supabase-js');

let _sb = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth
  const expected = process.env.PARSER_SECRET;
  if (!expected) {
    console.error('[pro-demo-parsed] PARSER_SECRET non configure');
    return res.status(503).json({ error: 'Parser secret not configured' });
  }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Missing body' });
  }

  const { proMatchMapId, eventCount, status, errorMessage, parserVersion, tickRate } = body;
  if (!proMatchMapId) return res.status(400).json({ error: 'proMatchMapId required' });
  if (!status || !['parsed','failed'].includes(status)) {
    return res.status(400).json({ error: 'status must be parsed|failed' });
  }

  try {
    const update = {
      status,
      parse_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (typeof eventCount === 'number') update.event_count = eventCount;
    if (errorMessage) update.error_message = errorMessage;
    if (parserVersion) update.parser_version = parserVersion;
    if (typeof tickRate === 'number') update.tick_rate = tickRate;

    const { error } = await sb()
      .from('pro_demos')
      .update(update)
      .eq('pro_match_map_id', proMatchMapId);

    if (error) {
      console.error('[pro-demo-parsed] DB error:', error);
      return res.status(500).json({ error: 'DB update failed', detail: error.message });
    }

    console.log(`[pro-demo-parsed] ${proMatchMapId} → ${status} (${eventCount || '?'} events)`);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[pro-demo-parsed] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
