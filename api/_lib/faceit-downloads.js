// api/_lib/faceit-downloads.js
// Client FACEIT Downloads API : transforme un `resource_url` (URL publique
// du fichier .dem.zst chez demos.faceit.com) en URL signee telechargeable
// avec une duree de vie courte (~5 min).
//
// Auth : Bearer FACEIT_API_KEY (Server-side API Key avec scope downloads_api).
// Endpoint : POST https://open.faceit.com/download/v2/demos/download
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

function getApiKey() {
  const key = process.env.FACEIT_API_KEY;
  if (!key) {
    throw new FaceitDownloadsError('FACEIT_API_KEY not configured', { status: 503 });
  }
  return key;
}

// Recupere les details d'un match pour extraire son demo_url.
// Le demo_url est dans `match.demo_url` (array de strings, generalement 1 par map).
//
// matchId : '1-xxxxxxxx-...' (UUID FACEIT match ID)
// retourne : { demo_urls: string[], status: string, finished_at: number }
async function getMatchDemoUrls(matchId) {
  if (!matchId) throw new FaceitDownloadsError('matchId required');
  const apiKey = getApiKey();

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
  const apiKey = getApiKey();

  const res = await fetch(`${FACEIT_DOWNLOADS_BASE}/demos/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
