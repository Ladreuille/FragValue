// api/watchlist.js // FragValue
// Gestion de la watchlist : ajouter / retirer / lister les joueurs suivis.
// Appele depuis scout.html (bouton "Suivre") et compare.html.
//
// POST   /api/watchlist  body { action: 'add', nickname, elo?, level?, avatar_url?, note? }
// POST   /api/watchlist  body { action: 'remove', nickname }
// GET    /api/watchlist  -> liste de la watchlist de l'user

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non authentifie' });

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Session invalide' });

    if (req.method === 'GET') {
      const { data } = await supabase
        .from('watchlist')
        .select('*')
        .eq('user_id', user.id)
        .order('added_at', { ascending: false });
      return res.status(200).json({ items: data || [] });
    }

    if (req.method === 'POST') {
      const { action, nickname, elo, level, avatar_url, note } = req.body || {};
      if (!action || !nickname) return res.status(400).json({ error: 'action et nickname requis' });

      if (action === 'add') {
        // Check doublons
        const { data: existing } = await supabase
          .from('watchlist')
          .select('id')
          .eq('user_id', user.id)
          .eq('faceit_nickname', nickname)
          .maybeSingle();
        if (existing) return res.status(200).json({ ok: true, already: true });

        const { error } = await supabase.from('watchlist').insert({
          user_id: user.id,
          faceit_nickname: nickname,
          faceit_elo:      elo || null,
          faceit_level:    level || null,
          avatar_url:      avatar_url || null,
          note:            note || null,
        });
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (action === 'remove') {
        const { error } = await supabase
          .from('watchlist')
          .delete()
          .eq('user_id', user.id)
          .eq('faceit_nickname', nickname);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'action inconnue' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('watchlist error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
