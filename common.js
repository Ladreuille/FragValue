// ═══ FragValue Common JS ══════════════════════════════════════════════════
// Shared Supabase client + auth state management + plan gating helpers

const SUPABASE_URL  = 'https://xmyruycvvkmcwysfygcq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhteXJ1eWN2dmttY3d5c2Z5Z2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTQzMzcsImV4cCI6MjA4OTUzMDMzN30.TaPIaI7puA3qnIrkHQ-VL9o9QgegmOjJR8yYVYsi8oI';

// Supabase client (requires supabase-js loaded via CDN before this script)
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
window._sb = _sb;

// Update nav auth state: show/hide login vs account buttons
async function initNavAuth() {
  const { data } = await _sb.auth.getSession();
  const loginBtn = document.getElementById('navLoginBtn');
  const accountBtn = document.getElementById('navAccountBtn');
  if (data.session) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (accountBtn) accountBtn.style.display = '';
  } else {
    if (loginBtn) loginBtn.style.display = '';
    if (accountBtn) accountBtn.style.display = 'none';
  }
}

// Auto-init nav auth on load
document.addEventListener('DOMContentLoaded', initNavAuth);

// ═══ PLAN GATING HELPERS ═════════════════════════════════════════════════
// getUserPlan() returns 'free' | 'pro' | 'team' (defaults 'free')
// Cached for 5 minutes in sessionStorage to avoid spamming check-subscription.

const PLAN_CACHE_KEY = 'fv_user_plan';
const PLAN_CACHE_TTL = 5 * 60 * 1000; // 5 min

async function getUserPlan() {
  // Check cache
  try {
    const raw = sessionStorage.getItem(PLAN_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && cached.ts && (Date.now() - cached.ts) < PLAN_CACHE_TTL) {
        return cached.plan || 'free';
      }
    }
  } catch (_) {}

  // Not cached or expired: call API
  try {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session) {
      // Non connecte = free (cache short TTL)
      try {
        sessionStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ plan: 'free', ts: Date.now() }));
      } catch (_) {}
      return 'free';
    }

    const res = await fetch('/api/check-subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
      },
    });
    if (!res.ok) return 'free';
    const d = await res.json();
    const plan = d.plan || 'free';

    try {
      sessionStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ plan, ts: Date.now() }));
    } catch (_) {}

    return plan;
  } catch (_) {
    return 'free';
  }
}

// isPro(): convenience wrapper, returns true for pro or team
async function isPro() {
  const plan = await getUserPlan();
  return plan === 'pro' || plan === 'team';
}

// Clear plan cache (call after login / logout / plan change)
function clearPlanCache() {
  try { sessionStorage.removeItem(PLAN_CACHE_KEY); } catch (_) {}
}

// Show a Pro upgrade modal anchored on a feature name.
// featureName is displayed in the modal title. ctaHref defaults to pricing.html.
function showProUpgradeModal(featureName, ctaHref) {
  ctaHref = ctaHref || 'pricing.html';
  const existing = document.getElementById('fvProUpgradeModal');
  if (existing) { existing.style.display = 'flex'; return; }

  var overlay = document.createElement('div');
  overlay.id = 'fvProUpgradeModal';
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:99999',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:rgba(0,0,0,.75)',
    'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)',
  ].join(';');

  overlay.innerHTML = [
    '<div style="background:#0f1010;border:1px solid #1c1e1e;border-radius:12px;padding:36px 32px;max-width:420px;width:90%;text-align:center;position:relative">',
    '  <button aria-label="Fermer" onclick="document.getElementById(\'fvProUpgradeModal\').style.display=\'none\'" style="position:absolute;top:14px;right:14px;width:28px;height:28px;background:transparent;border:1px solid #252727;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center">',
    '    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#7a8080" stroke-width="1.5" stroke-linecap="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>',
    '  </button>',
    '  <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(184,255,87,.1);color:#b8ff57;padding:4px 10px;border-radius:40px;font-family:\'Space Mono\',monospace;font-size:10px;font-weight:700;letter-spacing:.08em;margin-bottom:18px">',
    '    PRO',
    '  </div>',
    '  <div style="font-family:\'Anton\',sans-serif;font-size:24px;line-height:1.15;letter-spacing:.01em;color:#e8eaea;margin-bottom:12px">',
    (featureName || 'Fonctionnalite Pro'),
    '  </div>',
    '  <p style="font-family:\'Space Mono\',monospace;font-size:12px;color:#7a8080;line-height:1.7;margin-bottom:24px">',
    '    Cette fonctionnalite est reservee aux abonnes Pro. Passe au plan Pro des 9 euros/mois pour debloquer toutes les analyses avancees.',
    '  </p>',
    '  <a href="' + ctaHref + '" style="display:inline-block;background:#b8ff57;color:#000;padding:12px 28px;border-radius:6px;font-family:\'Space Mono\',monospace;font-size:12px;font-weight:700;text-decoration:none;letter-spacing:.04em">Voir les plans</a>',
    '  <div style="margin-top:14px">',
    '    <button onclick="document.getElementById(\'fvProUpgradeModal\').style.display=\'none\'" style="background:none;border:none;color:#4a5050;font-family:\'Space Mono\',monospace;font-size:11px;cursor:pointer;letter-spacing:.04em">Plus tard</button>',
    '  </div>',
    '</div>',
  ].join('');

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) overlay.style.display = 'none';
  });

  document.body.appendChild(overlay);
}

// ═══ SECURITY : XSS escape helper ═════════════════════════════════════════
// A utiliser sur TOUT contenu user-controlled avant innerHTML concat.
// Sources typiques : URL params, nickname FACEIT, donnees de demo uploadee,
// noms de maps venant du backend.
// Exemple : el.innerHTML = `<div>${fvEscapeHtml(userInput)}</div>`;
function fvEscapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Expose helpers globally so pages without module imports can use them
window.getUserPlan = getUserPlan;
window.isPro = isPro;
window.clearPlanCache = clearPlanCache;
window.showProUpgradeModal = showProUpgradeModal;
window.fvEscapeHtml = fvEscapeHtml;
