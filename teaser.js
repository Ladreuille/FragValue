/* FragValue teaser helper
   - Waitlist DB backed (POST /api/feature-waitlist) + localStorage fallback
   - Live counter basé sur le total réel de la vue SQL
   - Active la CTA "Activer les notifications" et la passe en "Intérêt enregistré"
*/
(function(){
  // i18n : detection langue + dictionnaire
  const FV_LANG = (document.documentElement.lang === 'en'
                || window.location.pathname.startsWith('/en/')) ? 'en' : 'fr';
  const T = FV_LANG === 'en' ? {
    saved: 'Interest registered', saving: 'Saving...',
    netError: 'Network error. Try again in a moment.',
    locale: 'en-US',
  } : {
    saved: 'Intérêt enregistré', saving: 'Enregistrement...',
    netError: 'Erreur reseau. Reessaie dans un instant.',
    locale: 'fr-FR',
  };

  const ls = window.localStorage;
  const KEY = 'fv_teaser_interests';
  const API = '/api/feature-waitlist';

  function readLS(){
    try { return JSON.parse(ls.getItem(KEY) || '{}') || {}; }
    catch(_){ return {}; }
  }
  function writeLS(obj){
    try { ls.setItem(KEY, JSON.stringify(obj)); } catch(_){ /* quota */ }
  }

  async function getAuthHeader(){
    // Si page a cree window._sb, utilise-le. Sinon lis directement localStorage.
    try {
      if (window._sb?.auth?.getSession) {
        const { data } = await window._sb.auth.getSession();
        if (data?.session?.access_token) return 'Bearer ' + data.session.access_token;
      }
    } catch(_){}
    try {
      const raw = ls.getItem('sb-xmyruycvvkmcwysfygcq-auth-token');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.access_token) return 'Bearer ' + parsed.access_token;
    } catch(_){}
    return null;
  }

  async function fetchStatus(slug){
    const headers = {};
    const auth = await getAuthHeader();
    if (auth) headers['Authorization'] = auth;
    const res = await fetch(`${API}?feature=${encodeURIComponent(slug)}`, { headers });
    if (!res.ok) throw new Error('status ' + res.status);
    return res.json();
  }

  async function postInterest(slug){
    const headers = { 'Content-Type': 'application/json' };
    const auth = await getAuthHeader();
    if (auth) headers['Authorization'] = auth;
    const res = await fetch(API, {
      method: 'POST',
      headers,
      body: JSON.stringify({ feature: slug }),
    });
    if (!res.ok) throw new Error('post ' + res.status);
    return res.json();
  }

  function initCTA(slug, opts){
    opts = opts || {};
    const btn = document.querySelector('[data-teaser-cta="' + slug + '"]');
    const counter = document.querySelector('[data-teaser-counter="' + slug + '"]');

    const setSaved = () => {
      if (!btn) return;
      btn.dataset.state = 'saved';
      btn.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' +
        T.saved;
    };

    const renderCount = (n) => {
      if (counter) counter.textContent = (Number(n) || 0).toLocaleString(T.locale);
    };

    // 1. Optimistic : si localStorage dit "deja inscrit", on affiche tout de suite
    const local = readLS();
    if (local[slug]) setSaved();

    // 2. Synchro avec l'API (source de verite)
    fetchStatus(slug)
      .then(d => {
        renderCount(d.total);
        if (d.hasInterest) {
          setSaved();
          const cur = readLS();
          cur[slug] = Date.now();
          writeLS(cur);
        }
      })
      .catch(() => {
        // Offline / API down : fallback vers un seed pseudo-deterministe
        if (counter) {
          const base = opts.base || 40;
          const per = opts.perDay || 1.2;
          const days = Math.floor(Date.now() / 86400000);
          renderCount(base + Math.floor(per * (days - 19600)));
        }
      });

    // 3. Handler click
    if (!btn) return;
    btn.addEventListener('click', async (ev) => {
      if (btn.dataset.state === 'saved') return;
      ev.preventDefault();
      const prev = btn.innerHTML;
      btn.dataset.state = 'loading';
      btn.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:fvspin 0.8s linear infinite"><circle cx="12" cy="12" r="9" stroke-dasharray="42" stroke-dashoffset="12"/></svg>' +
        T.saving;
      try {
        const d = await postInterest(slug);
        renderCount(d.total);
        setSaved();
        const cur = readLS();
        cur[slug] = Date.now();
        writeLS(cur);
      } catch (e) {
        btn.dataset.state = '';
        btn.innerHTML = prev;
        console.warn('feature-waitlist failed', e);
        // Toast user : signale l'echec pour qu'il puisse retry ou comprendre
        showFeedbackToast(T.netError, 'error');
      }
    });
  }

  // Petit toast discret en bas d'ecran, auto-dismiss 4s
  function showFeedbackToast(msg, type) {
    if (type === void 0) type = 'info';
    const existing = document.getElementById('fv-teaser-toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.id = 'fv-teaser-toast';
    const bg = type === 'error' ? 'rgba(255,68,68,.12)' : type === 'ok' ? 'rgba(45,212,160,.12)' : 'rgba(184,255,87,.12)';
    const border = type === 'error' ? 'rgba(255,68,68,.4)' : type === 'ok' ? 'rgba(45,212,160,.4)' : 'rgba(184,255,87,.3)';
    const color = type === 'error' ? '#ff8a8a' : type === 'ok' ? '#2dd4a0' : '#b8ff57';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:' + bg + ';border:1px solid ' + border + ';color:' + color + ';padding:12px 20px;border-radius:8px;font-family:"Space Mono",monospace;font-size:12px;z-index:10000;backdrop-filter:blur(8px);box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:90vw;text-align:center';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 4000);
  }

  // Injecte keyframes spin une seule fois
  if (!document.getElementById('fv-teaser-style')) {
    const s = document.createElement('style');
    s.id = 'fv-teaser-style';
    s.textContent = '@keyframes fvspin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }

  window.FVTeaser = { initCTA };
})();
