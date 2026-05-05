// api/unsubscribe.js
// Endpoint de desinscription marketing.
//
// Flow :
//   GET  /api/unsubscribe?token=<base64url>
//     -> verifie le token HMAC
//     -> set profiles.marketing_opt_out=true + marketing_opt_out_at=now
//     -> redirect 302 vers /unsubscribed.html (page de confirmation)
//   GET  /api/unsubscribe?token=<base64url>&action=resubscribe
//     -> set marketing_opt_out=false
//     -> redirect vers /unsubscribed.html?status=resubscribed
//
// Le token est genere par api/_lib/email-unsub.js dans chaque email broadcast.
// Pas de TTL (RGPD : le lien doit fonctionner indefiniment).
//
// Anti-CSRF : on accepte GET (un clic depuis l'email = consentement explicite).
// Note : RFC 8058 List-Unsubscribe-Post existe pour le 1-click via POST mais
// la version GET reste valide pour les liens cliques manuellement.

const { createClient } = require('@supabase/supabase-js');
const { verifyUnsubToken } = require('./_lib/email-unsub.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.query?.token || '').trim();
  const action = (req.query?.action || 'unsubscribe').trim();

  if (!token) {
    return res.redirect(302, '/unsubscribed.html?status=invalid&reason=missing_token');
  }

  const verify = verifyUnsubToken(token);
  if (!verify.valid) {
    console.warn('[unsubscribe] invalid token:', verify.reason);
    return res.redirect(302, `/unsubscribed.html?status=invalid&reason=${encodeURIComponent(verify.reason)}`);
  }

  const { userId } = verify;

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const isResubscribe = action === 'resubscribe';
    const update = isResubscribe
      ? { marketing_opt_out: false, marketing_opt_out_at: null }
      : { marketing_opt_out: true, marketing_opt_out_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', userId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[unsubscribe] DB update failed:', error);
      return res.redirect(302, '/unsubscribed.html?status=error&reason=db');
    }
    if (!data) {
      console.warn(`[unsubscribe] no profile found for userId ${userId}`);
      return res.redirect(302, '/unsubscribed.html?status=invalid&reason=user_not_found');
    }

    // Audit log (best-effort, table optionnelle)
    try {
      await supabase.from('email_unsubscribe_log').insert({
        user_id: userId,
        action: isResubscribe ? 'resubscribed' : 'unsubscribed',
        ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
        user_agent: (req.headers['user-agent'] || '').slice(0, 200),
      });
    } catch (logErr) {
      // table non-critique : on log et on continue
    }

    return res.redirect(302, `/unsubscribed.html?status=${isResubscribe ? 'resubscribed' : 'ok'}&token=${token}`);
  } catch (err) {
    console.error('[unsubscribe] unexpected error:', err);
    return res.redirect(302, '/unsubscribed.html?status=error&reason=server');
  }
};
