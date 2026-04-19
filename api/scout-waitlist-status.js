// api/scout-waitlist-status.js // FragValue
// Retourne le statut du waitlist Scout : compteur users, threshold, unlock.
// Utilise par la page scout.html (teaser) pour afficher la progress bar live.

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // RPC SECURITY DEFINER (remplace l'ancienne view qui exposait auth.users)
    const { data: rows, error } = await supabase.rpc('scout_waitlist_progress');
    if (error) throw error;
    const data = rows?.[0] || {};

    // Cache leger cote CDN (refresh max toutes les 5 minutes)
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');

    return res.status(200).json({
      total_users: data.total_users || 0,
      opted_in_users: data.opted_in_users || 0,
      threshold: data.threshold || 1000,
      unlocked: !!data.unlocked,
      progress_pct: Math.min(100, Math.round(((data.total_users || 0) / (data.threshold || 1000)) * 100)),
    });
  } catch (err) {
    console.error('scout-waitlist-status error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
