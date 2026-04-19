/* FragValue feedback widget
   - Bouton flottant bas-droite present sur toutes les pages
   - Modal avec 4 types (positive/negative/idea/bug) + textarea + email optionnel
   - POST vers /api/feedback (auth automatique si user logge via supabase token)
   - LocalStorage pour ne pas reafficher le pulse "first-time" apres 1ere ouverture
*/
(function () {
  // Anti double-injection
  if (window.__fvFeedbackInit) return;
  window.__fvFeedbackInit = true;

  const LS_OPENED_ONCE = 'fv_feedback_opened';
  const TYPES = [
    { key: 'positive', label: 'Positif',  icon: '+', color: '#b8ff57', desc: 'Quelque chose qui marche bien' },
    { key: 'negative', label: 'Negatif',  icon: '-', color: '#ff4444', desc: 'Quelque chose qui ne va pas' },
    { key: 'idea',     label: 'Idee',     icon: '!', color: '#f5c842', desc: 'Une suggestion d\'amelioration' },
    { key: 'bug',      label: 'Bug',      icon: 'x', color: '#ff8a3d', desc: 'Quelque chose ne fonctionne pas' },
  ];

  // Recupere le token Supabase depuis localStorage (si page n'expose pas window._sb)
  function getAuthToken() {
    try {
      const raw = localStorage.getItem('sb-xmyruycvvkmcwysfygcq-auth-token');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.access_token || null;
    } catch { return null; }
  }

  // Styles : injection unique
  const css = `
    .fv-fb-btn{position:fixed;bottom:24px;right:24px;z-index:9998;width:52px;height:52px;border-radius:50%;background:#b8ff57;color:#000;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.4),0 0 0 0 rgba(184,255,87,.6);font-family:'Space Mono',monospace;font-weight:700;transition:transform .15s,box-shadow .15s}
    .fv-fb-btn:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 8px 24px rgba(184,255,87,.4)}
    .fv-fb-btn.fv-pulse{animation:fv-fb-pulse 2s ease-in-out infinite}
    @keyframes fv-fb-pulse{0%,100%{box-shadow:0 4px 16px rgba(0,0,0,.4),0 0 0 0 rgba(184,255,87,.6)}50%{box-shadow:0 4px 16px rgba(0,0,0,.4),0 0 0 12px rgba(184,255,87,0)}}
    .fv-fb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);z-index:9999;display:none;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .15s}
    .fv-fb-overlay.open{display:flex;opacity:1}
    .fv-fb-modal{background:#0f1010;border:1px solid #1c1e1e;border-radius:14px;padding:28px 28px 22px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.6);font-family:'Space Mono',monospace,system-ui;color:#e8eaea}
    .fv-fb-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
    .fv-fb-title{font-family:'Anton',sans-serif;font-size:24px;letter-spacing:.02em;color:#e8eaea;margin:0}
    .fv-fb-close{background:none;border:none;color:#7a8080;font-size:20px;cursor:pointer;padding:4px 8px;line-height:1;border-radius:6px;transition:all .15s}
    .fv-fb-close:hover{color:#e8eaea;background:#1c1e1e}
    .fv-fb-sub{font-size:12px;color:#7a8080;margin:0 0 18px;line-height:1.5}
    .fv-fb-types{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}
    .fv-fb-type{background:#131414;border:1px solid #1c1e1e;border-radius:10px;padding:12px 8px;cursor:pointer;text-align:center;transition:all .15s;color:#7a8080}
    .fv-fb-type:hover{border-color:#252727;color:#e8eaea}
    .fv-fb-type.active{background:rgba(184,255,87,.06);color:#e8eaea}
    .fv-fb-type-icon{font-family:'Anton',sans-serif;font-size:18px;line-height:1;margin-bottom:4px;display:block}
    .fv-fb-type-label{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .fv-fb-type-desc{font-size:10px;color:#4a5050;margin-top:12px;min-height:14px}
    .fv-fb-label{display:block;font-size:10px;color:#7a8080;letter-spacing:.06em;text-transform:uppercase;font-weight:700;margin:14px 0 6px}
    .fv-fb-textarea{width:100%;background:#080909;border:1px solid #1c1e1e;color:#e8eaea;font-family:'Space Mono',monospace;font-size:13px;padding:12px;border-radius:8px;resize:vertical;min-height:90px;outline:none;transition:border-color .15s;line-height:1.5;box-sizing:border-box}
    .fv-fb-textarea:focus{border-color:rgba(184,255,87,.4)}
    .fv-fb-counter{font-size:10px;color:#4a5050;text-align:right;margin-top:4px}
    .fv-fb-input{width:100%;background:#080909;border:1px solid #1c1e1e;color:#e8eaea;font-family:'Space Mono',monospace;font-size:13px;padding:10px 12px;border-radius:8px;outline:none;box-sizing:border-box}
    .fv-fb-input:focus{border-color:rgba(184,255,87,.4)}
    .fv-fb-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}
    .fv-fb-cancel{background:transparent;color:#7a8080;border:1px solid #1c1e1e;font-family:'Space Mono',monospace;font-size:11px;font-weight:700;padding:9px 16px;border-radius:6px;cursor:pointer;letter-spacing:.06em;text-transform:uppercase}
    .fv-fb-cancel:hover{color:#e8eaea;border-color:#252727}
    .fv-fb-submit{background:#b8ff57;color:#000;border:none;font-family:'Space Mono',monospace;font-size:11px;font-weight:700;padding:9px 18px;border-radius:6px;cursor:pointer;letter-spacing:.06em;text-transform:uppercase;transition:all .15s}
    .fv-fb-submit:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px)}
    .fv-fb-submit:disabled{opacity:.5;cursor:not-allowed}
    .fv-fb-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f1010;border:1px solid rgba(184,255,87,.3);color:#b8ff57;padding:12px 20px;border-radius:40px;font-family:'Space Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.04em;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,.5);opacity:0;transition:opacity .2s,transform .2s}
    .fv-fb-toast.show{opacity:1;transform:translateX(-50%) translateY(-4px)}
    .fv-fb-toast.err{color:#ff8a8a;border-color:rgba(255,68,68,.4)}
    @media (max-width:480px){.fv-fb-btn{bottom:16px;right:16px}}
  `;
  const styleTag = document.createElement('style');
  styleTag.textContent = css;
  document.head.appendChild(styleTag);

  // Bouton flottant
  const btn = document.createElement('button');
  btn.className = 'fv-fb-btn';
  btn.title = 'Donner ton feedback';
  btn.setAttribute('aria-label', 'Ouvrir le formulaire de feedback');
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  if (!localStorage.getItem(LS_OPENED_ONCE)) btn.classList.add('fv-pulse');
  document.body.appendChild(btn);

  // Modal (lazy : on construit au premier clic)
  let overlay = null;
  let selectedType = null;
  let isSubmitting = false;

  function buildModal() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'fv-fb-overlay';
    overlay.innerHTML = `
      <div class="fv-fb-modal" role="dialog" aria-labelledby="fv-fb-title">
        <div class="fv-fb-head">
          <h3 class="fv-fb-title" id="fv-fb-title">Ton feedback</h3>
          <button class="fv-fb-close" aria-label="Fermer">×</button>
        </div>
        <p class="fv-fb-sub">Dis-nous ce qui marche, ce qui coince, ou ce que tu aimerais voir. On lit tout.</p>

        <div class="fv-fb-types">
          ${TYPES.map(t => `
            <button class="fv-fb-type" data-type="${t.key}" type="button">
              <span class="fv-fb-type-icon" style="color:${t.color}">${t.icon}</span>
              <span class="fv-fb-type-label">${t.label}</span>
            </button>
          `).join('')}
        </div>
        <div class="fv-fb-type-desc" data-role="type-desc">Choisis un type pour commencer</div>

        <label class="fv-fb-label" for="fv-fb-msg">Ton message</label>
        <textarea class="fv-fb-textarea" id="fv-fb-msg" maxlength="2000" placeholder="Decris ce que tu veux nous partager..."></textarea>
        <div class="fv-fb-counter" data-role="counter">0 / 2000</div>

        <div data-role="email-block" style="display:none">
          <label class="fv-fb-label" for="fv-fb-email">Email (optionnel — pour qu'on puisse te repondre)</label>
          <input class="fv-fb-input" id="fv-fb-email" type="email" placeholder="ton@email.com" maxlength="200" />
        </div>

        <div class="fv-fb-actions">
          <button class="fv-fb-cancel" type="button">Annuler</button>
          <button class="fv-fb-submit" type="button" disabled>Envoyer</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const modal = overlay.querySelector('.fv-fb-modal');
    const closeBtn = overlay.querySelector('.fv-fb-close');
    const cancelBtn = overlay.querySelector('.fv-fb-cancel');
    const submitBtn = overlay.querySelector('.fv-fb-submit');
    const msgInput = overlay.querySelector('#fv-fb-msg');
    const counter = overlay.querySelector('[data-role="counter"]');
    const typeDesc = overlay.querySelector('[data-role="type-desc"]');
    const emailBlock = overlay.querySelector('[data-role="email-block"]');
    const emailInput = overlay.querySelector('#fv-fb-email');
    const typeBtns = overlay.querySelectorAll('.fv-fb-type');

    // Affiche email block uniquement si pas logge
    if (!getAuthToken()) emailBlock.style.display = 'block';

    typeBtns.forEach(b => {
      b.addEventListener('click', () => {
        typeBtns.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        selectedType = b.dataset.type;
        const meta = TYPES.find(t => t.key === selectedType);
        typeDesc.textContent = meta?.desc || '';
        typeDesc.style.color = meta?.color || '#7a8080';
        updateSubmitState();
      });
    });

    msgInput.addEventListener('input', () => {
      counter.textContent = msgInput.value.length + ' / 2000';
      updateSubmitState();
    });

    function updateSubmitState() {
      submitBtn.disabled = !selectedType || msgInput.value.trim().length < 3 || isSubmitting;
    }

    function close() {
      overlay.classList.remove('open');
    }

    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });

    submitBtn.addEventListener('click', async () => {
      if (isSubmitting) return;
      isSubmitting = true;
      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Envoi...';
      submitBtn.disabled = true;

      try {
        const headers = { 'Content-Type': 'application/json' };
        const token = getAuthToken();
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const body = {
          type: selectedType,
          message: msgInput.value.trim(),
          page_url: window.location.href.slice(0, 500),
          viewport: window.innerWidth + 'x' + window.innerHeight,
        };
        const emailVal = emailInput?.value.trim();
        if (!token && emailVal) body.anon_email = emailVal;

        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);

        showToast('Merci pour ton feedback');
        close();
        // Reset
        selectedType = null;
        msgInput.value = '';
        if (emailInput) emailInput.value = '';
        typeBtns.forEach(x => x.classList.remove('active'));
        typeDesc.textContent = 'Choisis un type pour commencer';
        typeDesc.style.color = '#4a5050';
        counter.textContent = '0 / 2000';
      } catch (e) {
        showToast(e.message || 'Erreur reseau', true);
      } finally {
        isSubmitting = false;
        submitBtn.textContent = originalText;
        updateSubmitState();
      }
    });
  }

  function showToast(text, isError) {
    const toast = document.createElement('div');
    toast.className = 'fv-fb-toast' + (isError ? ' err' : '');
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }

  btn.addEventListener('click', () => {
    buildModal();
    overlay.classList.add('open');
    btn.classList.remove('fv-pulse');
    localStorage.setItem(LS_OPENED_ONCE, '1');
  });
})();
