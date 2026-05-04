// api/parse-from-faceit-url.js
//
// Endpoint user-facing : prend une URL match FACEIT (ou un match_id direct),
// resout le demo_url via la Data API, demande une URL signee via la Downloads
// API, et fire le parser Railway en mode override URL (meme pattern que
// submit-demo-url.js mais sans dependre de l'extension Chrome).
//
// Use case : sur demo.html, le user colle l'URL de son match FACEIT
// (ex: 'https://www.faceit.com/fr/cs2/room/1-xxx-...') au lieu de drag-drop
// le .dem manuel. On fait tout cote serveur grace au scope downloads_api.
//
// Auth : Supabase JWT obligatoire (le user doit etre logge).
// Rate-limiting : indirect via les quotas Free/Pro (table analyses ou similaire).
//
// Body : { faceitInput: string }  // URL match OU match_id direct
// Response 200 : { ok: true, matchId, queued: true, signedUrlIssued: true }
// Response 4xx : erreurs detaillees (matchId invalide, demo not found,
//                scope manquant, demo trop ancienne, etc.)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PARSER_URL = process.env.PARSER_URL || 'https://fragvalue-demo-parser-production.up.railway.app';
// Re-utilise la meme convention que submit-demo-url.js : FACEIT_WEBHOOK_SECRET
// sert aussi de PARSER_SECRET (auth entre Vercel et le parser Railway).
// TODO refactor : separer en PARSER_SECRET dedie pour eviter la confusion.
const PARSER_SECRET = process.env.PARSER_SECRET || process.env.FACEIT_WEBHOOK_SECRET || '';

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

  // Lazy require pour eviter les cold-start penalty si jamais l'endpoint
  // n'est pas hit (fichiers .js charges au call uniquement).
  const {
    extractMatchIdFromUrl,
    getSignedDownloadUrlsForMatch,
    FaceitDownloadsError,
  } = require('./_lib/faceit-downloads.js');

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token invalide' });

    const { faceitInput } = req.body || {};
    if (!faceitInput || typeof faceitInput !== 'string') {
      return res.status(400).json({ error: 'faceitInput required (URL match FACEIT ou match_id)' });
    }

    const matchId = extractMatchIdFromUrl(faceitInput);
    if (!matchId) {
      return res.status(400).json({
        error: 'URL match FACEIT invalide. Format attendu : https://www.faceit.com/.../room/1-xxx-... ou directement le match_id (1-xxx-...).',
      });
    }

    // Verifie le quota du user (similaire a /api/parse pour upload manuel).
    // Fail-open si la fonction n'existe pas (dev local) pour ne pas bloquer.
    try {
      const { data: quota, error: quotaErr } = await supabase.rpc('check_user_analysis_quota', { p_user_id: user.id });
      if (!quotaErr && quota && quota.allowed === false) {
        return res.status(402).json({
          error: 'Quota d\'analyses depasse. Passe Pro pour des analyses sans limite.',
          code: 'quota_exceeded',
          quota,
        });
      }
    } catch (_) { /* fail-open */ }

    // Resout le demo_url + signed URL via la Downloads API.
    let resolved;
    try {
      resolved = await getSignedDownloadUrlsForMatch(matchId);
    } catch (err) {
      if (err instanceof FaceitDownloadsError) {
        // Mapping des erreurs FACEIT en messages user-friendly.
        if (err.code === 'no_scope') {
          console.error('[parse-from-faceit-url] FACEIT_API_KEY missing downloads_api scope');
          return res.status(503).json({
            error: 'Service temporairement indisponible (scope FACEIT manquant). Contacte le support.',
            code: 'no_scope',
          });
        }
        if (err.code === 'demo_not_found' || err.status === 404) {
          return res.status(404).json({
            error: 'Demo introuvable cote FACEIT. Les demos sont disponibles ~2-4 semaines apres le match.',
            code: 'demo_not_found',
          });
        }
        if (err.code === 'unauthorized' || err.status === 401) {
          return res.status(503).json({
            error: 'Service temporairement indisponible (auth FACEIT). Reessaie dans quelques minutes.',
            code: 'unauthorized',
          });
        }
      }
      console.error('[parse-from-faceit-url] FACEIT API error:', err.message, err.body);
      return res.status(502).json({ error: 'Erreur cote FACEIT. Reessaie ou colle un autre match.' });
    }

    if (!resolved.signed_urls || resolved.signed_urls.length === 0) {
      return res.status(404).json({
        error: 'Aucune demo disponible pour ce match. Le match est peut-etre encore en cours, ou la demo a expire.',
        code: 'no_demos',
        match_status: resolved.status,
      });
    }

    // Pour les BO3/BO5, on prend la premiere demo (1ere map). Si l'user veut
    // analyser une map specifique, on pourra exposer un selecteur plus tard.
    const signedUrl = resolved.signed_urls[0];

    // Upsert le match en DB (status='parsing').
    const upsertPayload = {
      id: matchId,
      faceit_match_id: matchId,
      user_id: user.id,
      status: 'parsing',
      demo_url: signedUrl,
      error_message: null,
    };
    if (resolved.map) upsertPayload.map = resolved.map;

    const { error: upsertErr } = await supabase
      .from('matches')
      .upsert(upsertPayload, { onConflict: 'faceit_match_id' });

    if (upsertErr) {
      console.error('[parse-from-faceit-url] DB upsert error:', upsertErr);
      return res.status(500).json({ error: 'Echec enregistrement DB' });
    }

    // Fire le parser Railway avec l'URL signee. Le parser fetch + decompress
    // (.dem.zst) + parse + write back dans matches.
    try {
      const parserRes = await fetch(`${PARSER_URL}/process-match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PARSER_SECRET}`,
        },
        body: JSON.stringify({ matchId, demoUrl: signedUrl }),
      });
      if (!parserRes.ok) {
        const txt = await parserRes.text().catch(() => '');
        console.warn('[parse-from-faceit-url] parser non-200:', parserRes.status, txt.slice(0, 200));
      }
    } catch (err) {
      console.error('[parse-from-faceit-url] parser fire error:', err.message);
      // Ne fail pas la requete : le row est en parsing, l'user peut retry.
    }

    // Track le source (URL submit vs upload manual) pour analytics.
    try {
      await supabase.from('match_source_log').insert({
        user_id: user.id,
        match_id: matchId,
        source: 'faceit_url',
        created_at: new Date().toISOString(),
      });
    } catch (_) { /* table optionnelle */ }

    return res.status(200).json({
      ok: true,
      matchId,
      queued: true,
      signedUrlIssued: true,
      mapDetected: resolved.map || null,
    });
  } catch (err) {
    console.error('[parse-from-faceit-url] error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
