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
// Atomique via optimistic lock (SELECT then UPDATE avec WHERE balance=N).
//
// FIX (cf. ultrareview P1.10) : ajout d'1 retry si l'optimistic lock echoue
// (cas race condition : 2 messages simultanes du meme user). Sans retry, le
// 2e message echouait avec "update_failed" alors que le solde post-1er-update
// est encore > 0. Avec retry, on relit le solde frais et on retente.
//
// Log la transaction dans coach_credits_log.
//
// Retourne { ok: bool, balance_after, error?, retried? }.
async function consumeCredit(supabase, userId, messageId) {
  const MAX_ATTEMPTS = 3;
  let attempt = 0;
  let lastError = null;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    // Lecture du solde frais + check expiration (a chaque iteration)
    const current = await getCredits(supabase, userId);
    if (current.expired) {
      return { ok: false, error: 'credits_expired', balance_after: 0 };
    }
    if (current.balance <= 0) {
      return { ok: false, error: 'no_credits', balance_after: 0 };
    }

    const newBalance = current.balance - 1;

    // Update atomique avec optimistic lock
    const { data: updated, error: updErr } = await supabase
      .from('coach_credits')
      .update({ balance: newBalance })
      .eq('user_id', userId)
      .eq('balance', current.balance)
      .select('balance');

    if (updErr) {
      console.error('[coach-credits] consumeCredit update error attempt', attempt, ':', updErr.message);
      lastError = updErr.message;
      // Retry sur erreur reseau/DB transient
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 50 * attempt)); // backoff 50/100/150ms
        continue;
      }
      return { ok: false, error: 'update_failed', balance_after: current.balance };
    }

    // Optimistic lock perdu : 0 row updated -> retry avec balance fraiche
    if (!updated || updated.length === 0) {
      lastError = 'optimistic_lock_conflict';
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 30 * attempt));
        continue;
      }
      return { ok: false, error: 'race_conflict_retries_exhausted', balance_after: current.balance };
    }

    // Succes : log la transaction
    await supabase.from('coach_credits_log').insert({
      user_id:       userId,
      type:          'consumption',
      delta:         -1,
      balance_after: newBalance,
      message_id:    messageId || null,
      metadata:      { reason: 'over_quota_chat_message', attempts: attempt },
    });

    return { ok: true, balance_after: newBalance, retried: attempt > 1 };
  }

  return { ok: false, error: lastError || 'unknown', balance_after: 0 };
}

// Ajoute des credits suite a un achat Stripe reussi.
// Si la row n'existe pas, on l'insert. Sinon, on ajoute au solde.
// Met a jour expires_at = now() + 90 jours (reset a chaque achat).
//
// IDEMPOTENCE (cf. ultrareview SEC P0) : early-return si stripeSessionId
// a deja ete processe. Stripe peut rejouer un webhook si on lui retourne
// 5xx ou s'il timeout. Sans cet early-return, on creditait 2x l'user.
// Combine avec UNIQUE INDEX sur coach_credits_log.stripe_session pour
// defense-in-depth (l'INSERT echouera si by-pass de check).
//
// Retourne { ok, balance_after, idempotent? }.
async function addCredits(supabase, userId, packKey, stripeSessionId) {
  const pack = PACKS[packKey];
  if (!pack) {
    return { ok: false, error: 'unknown_pack' };
  }

  // === IDEMPOTENCE CHECK : session deja processee ? ===
  if (stripeSessionId) {
    const { data: existing, error: selErr } = await supabase
      .from('coach_credits_log')
      .select('id, balance_after, created_at')
      .eq('stripe_session', stripeSessionId)
      .eq('type', 'purchase')
      .maybeSingle();
    if (selErr) {
      console.warn('[coach-credits] idempotence check failed:', selErr.message);
      // En cas d'erreur DB sur le check, on continue (UNIQUE INDEX protege en
      // dernier recours, l'INSERT echouera s'il y a vraiment doublon).
    } else if (existing) {
      console.log(`[coach-credits] addCredits IDEMPOTENT skip : session ${stripeSessionId} deja processee (log id ${existing.id})`);
      return {
        ok: true,
        idempotent: true,
        balance_after: existing.balance_after,
        already_processed_at: existing.created_at,
      };
    }
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

  // Log la transaction. UNIQUE INDEX sur stripe_session protege en cas de
  // race (2 webhook handlers en parallele) - l'INSERT echouera proprement.
  const { error: logErr } = await supabase.from('coach_credits_log').insert({
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
  if (logErr && /duplicate key|unique constraint/i.test(logErr.message)) {
    console.warn(`[coach-credits] addCredits DUPLICATE detected (race), session=${stripeSessionId}`);
    // Race detectee : un autre worker a credit dans le meme temps. On lit le
    // solde courant (la 1ere insertion a bien fait son boulot).
    const refreshed = await getCredits(supabase, userId);
    return { ok: true, idempotent: true, balance_after: refreshed.balance };
  } else if (logErr) {
    console.error('[coach-credits] log insert failed:', logErr.message);
    // L'upsert credit a deja eu lieu, c'est juste le log qui rate. Pas critique.
  }

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
