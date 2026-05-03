// api/notifications.js
// GET : liste des notifications de l'utilisateur
// POST : marque une ou plusieurs notifs comme lues
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non authentifie' });

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token invalide' });

    if (req.method === 'GET') {
      const limit = Math.min(100, parseInt(req.query.limit, 10) || 30);
      const unreadOnly = req.query.unread_only === '1';
      let q = supabase
        .from('notifications')
        .select('id, type, title, message, action_url, icon, metadata, read, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (unreadOnly) q = q.eq('read', false);
      const { data: notifs, error } = await q;
      if (error) {
        console.error('[notifications] select error:', error);
        return res.status(500).json({ error: 'Erreur lecture' });
      }

      // Count total unread pour le badge (meme si la liste est filtree)
      const { count: unreadCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);

      return res.status(200).json({
        notifications: notifs || [],
        unread: unreadCount || 0,
      });
    }

    if (req.method === 'POST') {
      const { ids, all } = req.body || {};
      if (all) {
        await supabase
          .from('notifications')
          .update({ read: true })
          .eq('user_id', user.id)
          .eq('read', false);
      } else if (Array.isArray(ids) && ids.length) {
        await supabase
          .from('notifications')
          .update({ read: true })
          .eq('user_id', user.id)
          .in('id', ids);
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      // Clear notifs : SECURISE (cf. ultrareview P0.6).
      // Avant : DELETE sans param supprimait TOUTES les notifs du user (data loss
      // accidentelle si bug front qui call sans confirmation).
      // Maintenant : exiger explicitement un filtre OU confirm=1.
      const olderThan = req.query.older_than_days
        ? new Date(Date.now() - parseInt(req.query.older_than_days, 10) * 86400000).toISOString()
        : null;
      const readOnly = req.query.read_only === '1';
      const confirmAll = req.query.confirm === 'all';

      // Garde-fou : refus du delete-all sans flag explicite
      if (!olderThan && !readOnly && !confirmAll) {
        return res.status(400).json({
          error: 'Filtre requis',
          hint: 'Specifie ?read_only=1, ?older_than_days=N ou ?confirm=all pour tout supprimer.',
        });
      }

      let q = supabase.from('notifications').delete().eq('user_id', user.id);
      if (readOnly) q = q.eq('read', true);
      if (olderThan) q = q.lt('created_at', olderThan);
      await q;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('notifications error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
