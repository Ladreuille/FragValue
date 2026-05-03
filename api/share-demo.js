// api/share-demo.js
// Cree un lien de partage public pour une demo analysee
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: recuperer une demo partagee
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID manquant' });

    const { data, error } = await supabase
      .from('shared_demos')
      .select('*, demos(*)')
      .eq('share_id', id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Demo non trouvee' });

    // Verifier expiration
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Lien expire' });
    }

    // Cache CDN 1h : la demo partagee est immuable une fois creee, peut etre cachee
    // agressivement. Stale-while-revalidate 24h pour resilience. Impact : un share
    // viral (Twitter/Discord) ne hit la DB Supabase qu'une fois par heure.
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      share_id: data.share_id,
      demo: data.demos,
      created_at: data.created_at,
    });
  }

  // POST: creer un lien de partage
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non authentifie' });

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token invalide' });

    const { demo_id } = req.body;
    if (!demo_id) return res.status(400).json({ error: 'demo_id manquant' });

    // Verifier que la demo appartient a l'utilisateur
    const { data: demo } = await supabase
      .from('demos')
      .select('id')
      .eq('id', demo_id)
      .eq('user_id', user.id)
      .single();

    if (!demo) return res.status(404).json({ error: 'Demo non trouvee' });

    // Verifier si un lien existe deja
    const { data: existing } = await supabase
      .from('shared_demos')
      .select('share_id')
      .eq('demo_id', demo_id)
      .single();

    if (existing) {
      return res.status(200).json({ share_id: existing.share_id });
    }

    // Creer le lien avec expiration 90 jours (cf. ultrareview P1.2 :
    // avant on ne settait jamais expires_at, donc le check ligne 35 etait
    // mort et les liens partages vivaient eternellement). 90j = duree raisonnable
    // pour un share match : suffisant pour analyse + retro, force le menage.
    const shareId = crypto.randomBytes(8).toString('hex');
    const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
    const { error: insertError } = await supabase
      .from('shared_demos')
      .insert({
        share_id: shareId,
        demo_id: demo_id,
        user_id: user.id,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error('share insert error:', insertError);
      return res.status(500).json({ error: 'Erreur creation du lien' });
    }

    return res.status(200).json({ share_id: shareId });
  } catch (err) {
    console.error('share-demo error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
