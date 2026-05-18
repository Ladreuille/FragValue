// api/_lib/faceit-downloads.js
// Client FACEIT Downloads API : transforme un `resource_url` (URL publique
// du fichier .dem.zst chez demos.faceit.com) en URL signee telechargeable
// avec une duree de vie courte (~5 min).
//
// AUTH (deux tokens DISTINCTS, NE PAS confondre - cf docs FACEIT mai 2026) :
//   - FACEIT_API_KEY : token Data API (lookup joueurs, match history). Gratuit,
//     dispo des l'app creee dans App Studio. Utilise pour /data/v4/*.
//   - FACEIT_DOWNLOADS_TOKEN : token EXCLUSIF Downloads API, obtenu via
//     application form https://fce.gg/downloads-api-application (review ~30j
//     par l'equipe partnerships@faceit.com). Sans ce token specifique,
//     /download/v2/* renvoie systematiquement 403 err_f0 "no valid scope".
//     Le token est livre par email apres validation.
//
// Endpoint Downloads : POST https://open.faceit.com/download/v2/demos/download
// Body : { "resource_url": "https://demos.faceit.com/cs2/...dem.zst" }
// Response : { "payload": { "download_url": "https://..." } }
//
// Doc : https://docs.faceit.com/getting-started/Guides/download-api/
// (note : la doc dit .dem.gz mais en pratique FACEIT delivre du .dem.zst)
//
// Ce module ne s'occupe PAS de :
// - Decompresser le .zst (delegue au parser Railway)
// - Telecharger le fichier (juste retourne le signed URL, le parser le fetch)
// - Retry / queue (delegue a l'appelant)

const FACEIT_DOWNLOADS_BASE = 'https://open.faceit.com/download/v2';
const FACEIT_DATA_BASE      = 'https://open.faceit.com/data/v4';

class FaceitDownloadsError extends Error {
  constructor(message, { status, code, body, cause } = {}) {
    super(message);
    this.name = 'FaceitDownloadsError';
    this.status = status;
    this.code = code;
    this.body = body;
    if (cause) this.cause = cause;
  }
}

// Token Data API (lookup joueurs, match history, profile). Required pour
// tous les appels /data/v4/* (gratuit, auto-disponible apres creation app).
function getDataApiKey() {
  const key = process.env.FACEIT_API_KEY;
  if (!key) {
    throw new FaceitDownloadsError('FACEIT_API_KEY not configured', { status: 503 });
  }
  return key;
}

// Token Downloads API (signed URL pour .dem). DIFFERENT du Data API key,
// gated par application form 30j. Fallback intentionnel sur FACEIT_API_KEY
// le temps que le token Downloads soit valide -> permet de tester en local
// avec une cle dev qui a les deux scopes, et fail clairement en prod si la
// var n'est pas set (au lieu de silently faillir avec no_scope).
function getDownloadsToken() {
  const token = process.env.FACEIT_DOWNLOADS_TOKEN;
  if (!token) {
    // On accepte FACEIT_API_KEY comme fallback (cas dev / cle multi-scope).
    // Si elle ne marche pas non plus, le 403 err_f0 sera intercept ci-dessous.
    const fallback = process.env.FACEIT_API_KEY;
    if (!fallback) {
      throw new FaceitDownloadsError(
        'FACEIT_DOWNLOADS_TOKEN not configured (application form required: https://fce.gg/downloads-api-application)',
        { status: 503, code: 'no_downloads_token' }
      );
    }
    return fallback;
  }
  return token;
}

// Recupere les details d'un match pour extraire son demo_url.
// Le demo_url est dans `match.demo_url` (array de strings, generalement 1 par map).
//
// matchId : '1-xxxxxxxx-...' (UUID FACEIT match ID)
// retourne : { demo_urls: string[], status: string, finished_at: number }
async function getMatchDemoUrls(matchId) {
  if (!matchId) throw new FaceitDownloadsError('matchId required');
  // Data API : utilise FACEIT_API_KEY (token Data API, gratuit).
  const apiKey = getDataApiKey();

  const url = `${FACEIT_DATA_BASE}/matches/${encodeURIComponent(matchId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { body = await res.text(); }
    throw new FaceitDownloadsError(
      `FACEIT match fetch failed: ${res.status}`,
      { status: res.status, body }
    );
  }

  const data = await res.json();
  const demoUrls = Array.isArray(data.demo_url) ? data.demo_url : (data.demo_url ? [data.demo_url] : []);
  return {
    demo_urls: demoUrls,
    status: data.status || null,
    finished_at: data.finished_at || null,
    match_id: data.match_id || matchId,
    started_at: data.started_at || null,
    map: data.voting?.map?.pick?.[0] || null,
  };
}

// Demande une URL signee de download pour un resource_url donne.
// resourceUrl : 'https://demos.faceit.com/cs2/1-xxx.dem.zst' (URL publique du fichier)
// retourne : string (URL signee, valide ~5 min)
async function requestSignedDownloadUrl(resourceUrl) {
  if (!resourceUrl) throw new FaceitDownloadsError('resourceUrl required');
  // Downloads API : utilise FACEIT_DOWNLOADS_TOKEN (token EXCLUSIF, gated par
  // application form 30j). Cf. commentaire en tete de fichier.
  const downloadsToken = getDownloadsToken();

  const res = await fetch(`${FACEIT_DOWNLOADS_BASE}/demos/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${downloadsToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resource_url: resourceUrl }),
  });

  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { body = await res.text(); }
    // Cas particuliers a remonter clairement a l'appelant
    let code = null;
    if (res.status === 403 && body?.errors?.[0]?.code === 'err_f0') {
      code = 'no_scope';
    } else if (res.status === 404) {
      code = 'demo_not_found';
    } else if (res.status === 401) {
      code = 'unauthorized';
    }
    throw new FaceitDownloadsError(
      `FACEIT downloads API failed: ${res.status} ${body?.errors?.[0]?.message || ''}`,
      { status: res.status, code, body }
    );
  }

  const data = await res.json();
  const signedUrl = data?.payload?.download_url;
  if (!signedUrl) {
    throw new FaceitDownloadsError(
      'FACEIT downloads API returned no download_url',
      { status: 502, body: data }
    );
  }
  return signedUrl;
}

// Helper de bout-en-bout : depuis un match_id, retourne les URLs signees
// pretes a etre fetch par le parser. Utile pour le worker DEMO_READY.
//
// matchId : '1-xxx...'
// retourne : { match_id, status, signed_urls: string[], errors: [] }
async function getSignedDownloadUrlsForMatch(matchId) {
  const meta = await getMatchDemoUrls(matchId);
  const signedUrls = [];
  const errors = [];

  for (const resourceUrl of meta.demo_urls) {
    try {
      const signed = await requestSignedDownloadUrl(resourceUrl);
      signedUrls.push(signed);
    } catch (err) {
      errors.push({
        resource_url: resourceUrl,
        error: err.message,
        code: err.code,
      });
    }
  }

  return {
    match_id: meta.match_id,
    status: meta.status,
    finished_at: meta.finished_at,
    map: meta.map,
    signed_urls: signedUrls,
    errors,
  };
}

// Extrait un match_id d'une URL FACEIT (web), si necessaire.
// Accepte : 'https://www.faceit.com/fr/cs2/room/1-xxx-...' ou directement '1-xxx-...'
// Retourne : '1-xxx-...' ou null si pas matche.
function extractMatchIdFromUrl(input) {
  if (!input) return null;
  const s = String(input).trim();
  // Deja un match_id pur
  if (/^1-[a-f0-9-]{30,}$/i.test(s)) return s;
  // URL avec le pattern /room/<match_id>
  const m = s.match(/\/room\/(1-[a-f0-9-]{30,})/i);
  if (m) return m[1];
  return null;
}

module.exports = {
  FaceitDownloadsError,
  getMatchDemoUrls,
  requestSignedDownloadUrl,
  getSignedDownloadUrlsForMatch,
  extractMatchIdFromUrl,
};
