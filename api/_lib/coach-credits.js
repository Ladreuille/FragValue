// api/_lib/coach-credits.js · FragValue · Phase 2 Coach IA credits
//
// Helpers DB pour gerer le systeme de credits achetes (Coach IA).
// 1 credit = 1 message envoye AU-DELA du quota tier (Pro 5/jour, Elite 30/jour).
//
// Tables : coach_credits (solde par user) + coach_credits_log (audit transactions).
// Validite : credits expirent 90 jours apres dernier achat.

const PACKS = {
  pack_50:  { credits: 50,  amount_cents: 400,  amount_eur: 4,  label: '50 credits Coach IA' },
  pack_200: { credits: 200, amount_cents: 1200, amount_eur: 12, label: '200 credits Coach IA' },
};

const CREDITS_VALIDITY_DAYS = 90;

// Recupere le solde courant + verifie si expires.
// Retourne { balance, expires_at, expired: bool }.
async function getCredits(supabase, userId) {
  const { data, error } = await supabase
    .from('coach_credits')
    .select('balance, expires_at, total_purchased, last_purchase_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[coach-credits] getCredits error:', error.message);
    return { balance: 0, expired: false, total_purchased: 0 };
  }
  if (!data) return { balance: 0, expired: false, total_purchased: 0 };

  // Check expiration
  const now = new Date();
  const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
  const expired = expiresAt && expiresAt < now;

  return {
    balance: expired ? 0 : (data.balance || 0),
    expires_at: data.expires_at,
    total_purchased: data.total_purchased || 0,
    expired: !!expired,
    last_purchase_at: data.last_purchase_at,
  };
}

// Consomme 1 credit pour un message envoye au-dela du quota tier.
// Atomique via RPC ou fallback : SELECT then UPDATE avec check balance > 0.
// Log la transaction dans coach_credits_log.
//
// Retourne { ok: bool, balance_after, error? }.
async function consumeCredit(supabase, userId, messageId) {
  // Lecture du solde + check expiration
  const current = await getCredits(supabase, userId);
  if (current.expired) {
    return { ok: false, error: 'credits_expired', balance_after: 0 };
  }
  if (current.balance <= 0) {
    return { ok: false, error: 'no_credits', balance_after: 0 };
  }

  const newBalance = current.balance - 1;

  // Update atomique avec verification (eviter race condition)
  const { error: updErr } = await supabase
    .from('coach_credits')
    .update({ balance: newBalance })
    .eq('user_id', userId)
    .eq('balance', current.balance); // optimistic lock
  if (updErr) {
    console.error('[coach-credits] consumeCredit update failed:', updErr.message);
    return { ok: false, error: 'update_failed', balance_after: current.balance };
  }

  // Log la transaction
  await supabase.from('coach_credits_log').insert({
    user_id:       userId,
    type:          'consumption',
    delta:         -1,
    balance_after: newBalance,
    message_id:    messageId || null,
    metadata:      { reason: 'over_quota_chat_message' },
  });

  return { ok: true, balance_after: newBalance };
}

// Ajoute des credits suite a un achat Stripe reussi.
// Si la row n'existe pas, on l'insert. Sinon, on ajoute au solde.
// Met a jour expires_at = now() + 90 jours (reset a chaque achat).
//
// Retourne { ok, balance_after }.
async function addCredits(supabase, userId, packKey, stripeSessionId) {
  const pack = PACKS[packKey];
  if (!pack) {
    return { ok: false, error: 'unknown_pack' };
  }

  // Calcul nouvelle expiration : +90 jours a partir d'aujourd'hui
  const newExpires = new Date();
  newExpires.setDate(newExpires.getDate() + CREDITS_VALIDITY_DAYS);

  // Lit le solde actuel pour calculer le nouveau
  const current = await getCredits(supabase, userId);
  const baseBalance = current.expired ? 0 : current.balance;
  const newBalance  = baseBalance + pack.credits;
  const newTotal    = (current.total_purchased || 0) + pack.credits;

  // Upsert (insert ou update)
  const { error: upsertErr } = await supabase
    .from('coach_credits')
    .upsert({
      user_id:                userId,
      balance:                newBalance,
      total_purchased:        newTotal,
      last_purchase_at:       new Date().toISOString(),
      last_purchase_session:  stripeSessionId,
      last_purchase_pack:     packKey,
      last_purchase_amount:   pack.amount_cents,
      expires_at:             newExpires.toISOString(),
    }, { onConflict: 'user_id' });
  if (upsertErr) {
    console.error('[coach-credits] addCredits upsert failed:', upsertErr.message);
    return { ok: false, error: 'upsert_failed' };
  }

  // Log la transaction
  await supabase.from('coach_credits_log').insert({
    user_id:       userId,
    type:          'purchase',
    delta:         pack.credits,
    balance_after: newBalance,
    stripe_session: stripeSessionId,
    metadata:      {
      pack:          packKey,
      amount_cents:  pack.amount_cents,
      amount_eur:    pack.amount_eur,
      expires_at:    newExpires.toISOString(),
    },
  });

  return { ok: true, balance_after: newBalance, expires_at: newExpires.toISOString() };
}

// Helper pour endpoint API : retourne tout le contexte credits d'un user
// (solde + dernier achat + expiration). Utilise par /api/coach-credits-status.
async function getCreditsStatus(supabase, userId) {
  const credits = await getCredits(supabase, userId);
  return {
    balance:         credits.balance,
    expires_at:      credits.expires_at,
    expired:         credits.expired,
    total_purchased: credits.total_purchased,
    last_purchase_at: credits.last_purchase_at,
    packs_available: Object.entries(PACKS).map(([key, pack]) => ({
      key,
      credits:      pack.credits,
      amount_eur:   pack.amount_eur,
      label:        pack.label,
    })),
    validity_days: CREDITS_VALIDITY_DAYS,
  };
}

module.exports = {
  PACKS,
  CREDITS_VALIDITY_DAYS,
  getCredits,
  consumeCredit,
  addCredits,
  getCreditsStatus,
};
