// api/delete-account.js // FragValue
// Suppression definitive d'un compte utilisateur.
// Cascade : profile + watchlist + roster + roster_players + demos + abonnement Stripe (si cancel non deja fait).
// ATTENTION : action irreversible cote utilisateur.

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
    const userId = user.id;

    // 1. Cancel Stripe subscription (si presente, au prochain period end)
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', userId)
        .single();
      if (profile?.stripe_customer_id && process.env.STRIPE_SECRET_KEY) {
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
        const subs = await stripe.subscriptions.list({
          customer: profile.stripe_customer_id,
          status: 'active',
          limit: 10,
        });
        for (const sub of subs.data) {
          await stripe.subscriptions.cancel(sub.id);
        }
      }
    } catch (e) {
      console.warn('Stripe cancel during account delete failed:', e.message);
      // Continue : on supprime quand meme le compte Supabase
    }

    // 2. Delete user data cascade dans Supabase
    // Les FK cascade doivent etre configurees en DB, mais on le fait explicitement
    // au cas ou pour garantir la purge.
    const tables = [
      'watchlist',
      'roster_players',  // via roster_id FK ailleurs, ici on nettoie par user_id si possible
      'rosters',
      'demos',
      'match_players',
      'profiles',
    ];
    for (const table of tables) {
      try {
        await supabase.from(table).delete().eq('user_id', userId);
      } catch (_) {}
    }
    // Profile utilise `id` pas `user_id`
    try { await supabase.from('profiles').delete().eq('id', userId); } catch (_) {}

    // 3. Delete auth user (Supabase admin)
    await supabase.auth.admin.deleteUser(userId);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Delete account error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
