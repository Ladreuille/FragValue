// faceit-oauth.js · FragValue
// Flow OAuth FACEIT partage entre login.html (signin/signup) et
// account.html / autres pages (linking d'un compte FACEIT a un user
// deja authentifie via email/Google).
//
// Usage :
//   <script src="/faceit-oauth.js"></script>
//   <button onclick="window.fvLoginFaceit()">Continuer avec FACEIT</button>
//
// Le callback (faceit-callback.html) detecte automatiquement le contexte :
// - Si une session Supabase existe deja (user authentifie via email/Google)
//   → upsert profile.faceit_* sur l'user courant et redirect vers /account.html
// - Sinon (premier signup via FACEIT) → cree user + session via OAuth magic
//   token retourne par /api/faceit-auth
//
// PKCE (Proof Key for Code Exchange) obligatoire : FACEIT exige le
// code_challenge sinon retourne {"errors":[{"message":"pkce_required"}]}.
//
// Mobile/iPad : iOS Safari bloque les popups OAuth. On detecte le touch
// et on redirige en full-page (le callback gere les 2 cas via fallback
// redirect dans showSuccess()).

(function () {
  'use strict';

  async function loginFaceit() {
    try {
      // 1. Recupere le clientId via /api/faceit-config (avec fallback hardcode)
      let clientId = '141a2533-b3b9-45e7-8c98-8cb683871f74';
      try {
        const res = await fetch('/api/faceit-config');
        const cfg = await res.json();
        if (cfg.clientId || cfg.client_id) clientId = cfg.clientId || cfg.client_id;
      } catch (_) {}

      const redirectUri = window.location.origin + '/faceit-callback.html';

      // 2. PKCE : code_verifier + code_challenge (SHA-256)
      const verifierBytes = new Uint8Array(32);
      crypto.getRandomValues(verifierBytes);
      const codeVerifier = btoa(String.fromCharCode(...verifierBytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
      const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      // 3. State aleatoire pour CSRF (complementaire a PKCE).
      const stateBytes = new Uint8Array(16);
      crypto.getRandomValues(stateBytes);
      const state = btoa(String.fromCharCode(...stateBytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      // 4. Stockage : localStorage pour partage popup<->parent + fallback sessionStorage
      localStorage.setItem('faceit_code_verifier', codeVerifier);
      localStorage.setItem('faceit_code_verifier_ts', String(Date.now()));
      localStorage.setItem('faceit_oauth_state', state);
      localStorage.setItem('faceit_redirect_uri', redirectUri);
      sessionStorage.setItem('faceit_code_verifier', codeVerifier);
      sessionStorage.setItem('faceit_oauth_state', state);

      // 5. Construction URL OAuth FACEIT
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'openid profile email',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      });
      const authUrl = 'https://accounts.faceit.com/?' + params.toString();

      // 6. Mobile/iPad : skip popup, full-page redirect
      // iOS Safari bloque ou convertit les popups en onglets, et
      // window.close() + window.opener ne marchent pas de maniere fiable.
      const isTouch = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)
                   || (/Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
                   || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
      if (isTouch) {
        window.location.href = authUrl;
        return;
      }

      // 7. Desktop : popup centree
      const w = 500, h = 700;
      const left = Math.round(screen.width / 2 - w / 2);
      const top = Math.round(screen.height / 2 - h / 2);
      const popup = window.open(authUrl, 'faceit_auth',
        'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);

      if (!popup) {
        // Popup bloque par le browser : fallback full-page
        window.location.href = authUrl;
        return;
      }

      // 8. Listener postMessage pour la fin du flow OAuth (popup -> parent)
      const handler = async (event) => {
        if (event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== 'FACEIT_AUTH_SUCCESS') return;
        window.removeEventListener('message', handler);
        clearInterval(checkClosed);
        try { popup.close(); } catch (_) {}
        // Reload la page courante pour refresh la session + UI (account.html
        // re-fetch profile.faceit_* automatiquement). Pour login.html, on
        // veut quand meme aller sur /account.html.
        const isLoginPage = /login\.html$/.test(window.location.pathname);
        setTimeout(() => {
          window.location.href = isLoginPage ? '/account.html' : window.location.pathname + window.location.hash;
        }, 200);
      };
      window.addEventListener('message', handler);

      // 9. Cleanup si l'user ferme le popup sans authoriser
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handler);
        }
      }, 500);

    } catch (err) {
      console.error('[faceit-oauth] login error:', err);
    }
  }

  // Expose globalement (window.fvLoginFaceit) pour les pages qui veulent
  // l'utiliser sans bundler.
  window.fvLoginFaceit = loginFaceit;
})();
