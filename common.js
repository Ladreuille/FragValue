// ═══ FragValue Common JS ══════════════════════════════════════════════════
// Shared Supabase client + auth state management

const SUPABASE_URL  = 'https://xmyruycvvkmcwysfygcq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhteXJ1eWN2dmttY3d5c2Z5Z2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTQzMzcsImV4cCI6MjA4OTUzMDMzN30.TaPIaI7puA3qnIrkHQ-VL9o9QgegmOjJR8yYVYsi8oI';

// Supabase client (requires supabase-js loaded via CDN before this script)
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

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
