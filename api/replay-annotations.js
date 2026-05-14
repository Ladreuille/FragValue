// api/replay-annotations.js · FragValue
//
// CRUD pour les annotations replay 2D :
//   GET  /api/replay-annotations?demo_id=<uuid>           → toutes annotations user (toutes rounds)
//   GET  /api/replay-annotations?demo_id=<uuid>&public=1  → annotations publiques pour cette demo
//   GET  /api/replay-annotations?share_id=<short>          → public via share link (NO auth required)
//   POST /api/replay-annotations { demo_id, round_num, payload, is_public, share }
//        → upsert (1 row par user/demo/round). share=true → genere share_id + is_public.
//   DELETE /api/replay-annotations { demo_id, round_num }  → delete user's annotation
//
// Auth : Bearer access token Supabase (frontend localStorage sb-*-auth-token).
// EXCEPTION : GET ?share_id ne necessite pas d'auth (acces public via short link).
// RLS gere les permissions cote DB : user voit/edit ses propres, public read si is_public.

const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');

// Genere un share_id court (~10 chars URL-safe alphanumeric).
function genShareId() {
  // Base32-ish : 10 chars, alphanumeric, no ambiguous chars (0/O, l/I)
  const ALPHA = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += ALPHA[bytes[i] % ALPHA.length];
  return out;
}

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const MAX_PAYLOAD_BYTES = 50 * 1024;  // 50KB max par annotation (suffisant pour ~100 strokes)

function corsOk(origin) {
  return ALLOWED_ORIGIN_RE.test(origin) || (origin && origin.startsWith('http://localhost'));
}

async function getUserFromToken(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  // Cree un client Supabase avec le service key pour valider le token user
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  return { user: data.user, token };
}

// Cree un client Supabase scope user (RLS-aware) en utilisant le JWT user.
function userScopedClient(token) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (corsOk(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ─── GET ?share_id : public access, NO auth required ────────────────
  // Permet a un coach de partager un lien /replay.html?annot_share=ABC123
  // que ses joueurs peuvent ouvrir sans compte FragValue.
  if (req.method === 'GET' && req.query?.share_id) {
    const shareId = String(req.query.share_id);
    if (!/^[A-Z0-9]{6,16}$/.test(shareId)) {
      return res.status(400).json({ error: 'share_id format invalide' });
    }
    // Use service key client (no RLS) car acces explicite public via share_id.
    // Filtre is_public + share_id pour s'assurer que le partage est volontaire.
    const sbAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await sbAdmin
      .from('fv_annotations')
      .select('demo_id, round_num, payload, updated_at')
      .eq('share_id', shareId)
      .eq('is_public', true);
    if (error) {
      console.error('[replay-annotations] share GET error:', error);
      return res.status(500).json({ error: 'DB error' });
    }
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Share link expire ou invalide' });
    }
    return res.status(200).json({ annotations: data, shared: true });
  }

  const auth = await getUserFromToken(req.headers.authorization);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const { user, token } = auth;
  const sb = userScopedClient(token);

  try {
    // ─── GET : list annotations (own + public) for a demo ────────────
    if (req.method === 'GET') {
      const demoId = req.query?.demo_id;
      const wantPublic = req.query?.public === '1' || req.query?.public === 'true';
      if (!demoId) return res.status(400).json({ error: 'demo_id required' });

      let query = sb.from('fv_annotations')
        .select('id, user_id, demo_id, round_num, payload, is_public, updated_at')
        .eq('demo_id', demoId);
      if (wantPublic) {
        // Toutes annotations publiques (RLS autorise)
        query = query.eq('is_public', true);
      } else {
        // Mes annotations uniquement
        query = query.eq('user_id', user.id);
      }
      const { data, error } = await query;
      if (error) {
        console.error('[replay-annotations] GET error:', error);
        return res.status(500).json({ error: 'DB error', detail: error.message });
      }
      return res.status(200).json({ annotations: data || [] });
    }

    // ─── POST : upsert annotation for a round ────────────────────────
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
      const { demo_id, round_num, payload = {}, is_public = false, share = false } = body || {};
      if (!demo_id) return res.status(400).json({ error: 'demo_id required' });
      if (typeof round_num !== 'number') return res.status(400).json({ error: 'round_num required (number)' });

      // Validation payload : taille + structure basique
      const payloadStr = JSON.stringify(payload);
      if (payloadStr.length > MAX_PAYLOAD_BYTES) {
        return res.status(413).json({ error: 'Payload too large', max: MAX_PAYLOAD_BYTES, got: payloadStr.length });
      }

      // Share flow : si share=true, set is_public + genere share_id (stable
      // si deja existe pour preserver les URLs precedentes du user).
      let shareId = null;
      let finalIsPublic = !!is_public;
      if (share === true) {
        finalIsPublic = true;
        const { data: existing } = await sb
          .from('fv_annotations')
          .select('share_id')
          .eq('user_id', user.id)
          .eq('demo_id', demo_id)
          .eq('round_num', round_num)
          .maybeSingle();
        shareId = existing?.share_id || genShareId();
      }

      const upsertRow = {
        user_id: user.id,
        demo_id,
        round_num,
        payload,
        is_public: finalIsPublic,
      };
      if (shareId) upsertRow.share_id = shareId;

      const { data, error } = await sb.from('fv_annotations').upsert(upsertRow, {
        onConflict: 'user_id,demo_id,round_num',
      })
        .select('id, round_num, is_public, share_id, updated_at')
        .single();

      if (error) {
        console.error('[replay-annotations] POST error:', error);
        return res.status(500).json({ error: 'DB error', detail: error.message });
      }
      return res.status(200).json({ annotation: data });
    }

    // ─── DELETE : delete annotation for a round ──────────────────────
    if (req.method === 'DELETE') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
      const { demo_id, round_num } = body || {};
      if (!demo_id || typeof round_num !== 'number') {
        return res.status(400).json({ error: 'demo_id + round_num required' });
      }
      const { error } = await sb.from('fv_annotations')
        .delete()
        .eq('user_id', user.id)
        .eq('demo_id', demo_id)
        .eq('round_num', round_num);
      if (error) {
        console.error('[replay-annotations] DELETE error:', error);
        return res.status(500).json({ error: 'DB error', detail: error.message });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[replay-annotations] FATAL:', e);
    return res.status(500).json({ error: e.message });
  }
};
