// scripts/stripe-status.js · FragValue
// Dashboard CLI pour voir d'un coup d'oeil :
//   - Tous tes customers Stripe et leur status d'abonnement
//   - Les abonnements en trial (qui n'ont pas encore paye)
//   - Les abonnements actifs (qui paient)
//   - Les factures impayees / a finaliser
//   - Les revenus mensuels recurrents (MRR) estimes
//
// USAGE
//   STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe-status.js
//
//   Ou avec un .env :
//     echo "STRIPE_SECRET_KEY=sk_live_xxx" >> .env.local
//     node -r dotenv/config scripts/stripe-status.js dotenv_config_path=.env.local
//
// SORTIE TYPE
//   📊 FragValue · Stripe Status · 2026-05-01
//
//   👥 CUSTOMERS (12)
//      └ Active subscriptions : 3
//      └ Trialing             : 5  (factures J+7)
//      └ Past due / canceled  : 2
//      └ No subscription      : 2
//
//   💳 SUBSCRIPTIONS DETAILS
//      [trialing] john@example.com · pro_monthly · trial ends 2026-05-04
//      [trialing] alice@x.fr      · elite_monthly · trial ends 2026-05-06
//      [active]   bob@gmail.com    · pro_monthly · next charge 2026-05-15 · 4.90 EUR
//
//   🧾 INVOICES (2 last weeks)
//      [paid]  in_xxx · 4.90 EUR · 2026-04-22 · bob@gmail.com
//      [draft] in_yyy · 9.90 EUR · 2026-04-30 · alice@x.fr (en trial, sortira J+7)
//
//   💰 MRR projete : 38.60 EUR (5 trial * + 3 active = 8 abos)

const Stripe = require('stripe');

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error('✗ STRIPE_SECRET_KEY manquante.');
  console.error('  Lance : STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe-status.js');
  process.exit(1);
}
if (!KEY.startsWith('sk_')) {
  console.error('✗ STRIPE_SECRET_KEY doit commencer par sk_ (tu as ' + KEY.slice(0, 8) + '...)');
  process.exit(1);
}

const stripe = new Stripe(KEY, { apiVersion: '2023-10-16' });
const MODE = KEY.startsWith('sk_live_') ? 'LIVE' : 'TEST';

// ── Helpers d'affichage ────────────────────────────────────────────────────

const fmt = (n) => (n / 100).toFixed(2);
const dateFmt = (ts) => ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '-';

function pad(s, n) { return String(s).slice(0, n).padEnd(n); }

// Couleurs ANSI minimales (sans dep)
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};
const head = (s) => c.bold + c.cyan + s + c.reset;

function statusColor(status) {
  if (status === 'active') return c.green + status + c.reset;
  if (status === 'trialing') return c.yellow + status + c.reset;
  if (status === 'past_due' || status === 'unpaid') return c.red + status + c.reset;
  if (status === 'canceled') return c.dim + status + c.reset;
  return status;
}

// ── Pagination helper ──────────────────────────────────────────────────────

async function listAll(method, params) {
  const all = [];
  for await (const item of stripe[method].list(params || { limit: 100 })) {
    all.push(item);
  }
  return all;
}

async function listAllAuto(method, params) {
  const all = [];
  let starting_after;
  while (true) {
    const opts = Object.assign({ limit: 100 }, params || {});
    if (starting_after) opts.starting_after = starting_after;
    const res = await stripe[method].list(opts);
    all.push(...res.data);
    if (!res.has_more) break;
    starting_after = res.data[res.data.length - 1].id;
  }
  return all;
}

// ── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  console.log('');
  console.log(head('📊 FragValue · Stripe Status · ' + today + '  [' + MODE + ' MODE]'));
  console.log('');

  // 1. Account info (sanity check)
  let account;
  try {
    account = await stripe.accounts.retrieve();
    console.log(c.dim + '   Compte : ' + account.business_profile?.name + ' (' + account.email + ')' + c.reset);
    console.log(c.dim + '   Pays   : ' + account.country + ' · Devise par defaut : ' + (account.default_currency || '?').toUpperCase() + c.reset);
    console.log('');
  } catch (e) {
    console.error('✗ Echec retrieve account: ' + e.message);
    process.exit(1);
  }

  // 2. Tous les customers + leurs subs (paginated)
  console.log(c.dim + '⏳ Fetching customers, subscriptions, invoices...' + c.reset);
  const [customers, subscriptions, invoices] = await Promise.all([
    listAllAuto('customers'),
    listAllAuto('subscriptions', { status: 'all' }),
    listAllAuto('invoices', {
      created: { gte: Math.floor(Date.now() / 1000) - 30 * 24 * 3600 },
    }),
  ]);

  // Map customer -> subs
  const subsByCustomer = new Map();
  subscriptions.forEach((s) => {
    const cid = typeof s.customer === 'string' ? s.customer : s.customer?.id;
    if (!cid) return;
    if (!subsByCustomer.has(cid)) subsByCustomer.set(cid, []);
    subsByCustomer.get(cid).push(s);
  });

  // 3. Buckets
  const buckets = {
    active: [], trialing: [], past_due: [], canceled: [], incomplete: [], other: [],
    no_sub: [],
  };

  customers.forEach((cust) => {
    const subs = subsByCustomer.get(cust.id) || [];
    if (subs.length === 0) {
      buckets.no_sub.push({ cust, sub: null });
      return;
    }
    // Privilegie l'abo non-canceled le plus recent
    const live = subs.find((s) => s.status === 'active' || s.status === 'trialing' || s.status === 'past_due')
              || subs.sort((a, b) => b.created - a.created)[0];
    const status = live.status;
    if (buckets[status]) buckets[status].push({ cust, sub: live });
    else buckets.other.push({ cust, sub: live });
  });

  // 4. Affichage : sommaire
  console.log('');
  console.log(head('👥 CUSTOMERS (' + customers.length + ')'));
  const show = (label, arr, color) =>
    console.log('   ' + (color || '') + pad(label, 24) + c.reset + ' : ' + c.bold + arr.length + c.reset);
  show('Active subscriptions', buckets.active, c.green);
  show('Trialing (J+7)', buckets.trialing, c.yellow);
  show('Past due', buckets.past_due, c.red);
  show('Canceled', buckets.canceled, c.dim);
  show('Incomplete', buckets.incomplete || [], c.dim);
  show('No subscription', buckets.no_sub, c.dim);
  console.log('');

  // 5. Detail subscriptions
  console.log(head('💳 SUBSCRIPTIONS DETAILS'));
  const printRow = (entry) => {
    const { cust, sub } = entry;
    const email = cust.email || '(no email)';
    const price = sub.items?.data?.[0]?.price;
    const planLbl = (sub.metadata?.plan || price?.nickname || price?.id || '?');
    const amount = price?.unit_amount ? fmt(price.unit_amount) + ' ' + (price.currency || 'eur').toUpperCase() : '?';

    let extra = '';
    if (sub.status === 'trialing' && sub.trial_end) {
      const daysLeft = Math.ceil((sub.trial_end * 1000 - Date.now()) / (24 * 3600 * 1000));
      extra = c.dim + 'trial ends ' + dateFmt(sub.trial_end) + ' (J+' + daysLeft + ')' + c.reset;
    } else if (sub.status === 'active' && sub.current_period_end) {
      extra = c.dim + 'next charge ' + dateFmt(sub.current_period_end) + c.reset;
    } else if (sub.status === 'canceled') {
      extra = c.dim + 'canceled ' + dateFmt(sub.canceled_at) + c.reset;
    }

    console.log('   [' + statusColor(sub.status) + '] '
      + pad(email, 32) + ' · ' + pad(planLbl, 16) + ' · ' + pad(amount, 14) + ' ' + extra);
  };

  ['trialing', 'active', 'past_due', 'incomplete', 'canceled'].forEach((k) => {
    if (buckets[k] && buckets[k].length) {
      console.log(c.dim + '  ── ' + k + ' ──' + c.reset);
      buckets[k].forEach(printRow);
    }
  });
  if (buckets.no_sub.length) {
    console.log(c.dim + '  ── no_subscription ──' + c.reset);
    buckets.no_sub.slice(0, 10).forEach((e) => {
      console.log('   [' + c.dim + 'none' + c.reset + '] '
        + pad(e.cust.email || '(no email)', 32) + ' · '
        + c.dim + 'created ' + dateFmt(e.cust.created) + c.reset);
    });
    if (buckets.no_sub.length > 10) {
      console.log(c.dim + '   ... + ' + (buckets.no_sub.length - 10) + ' autres' + c.reset);
    }
  }
  console.log('');

  // 6. Invoices recentes
  console.log(head('🧾 INVOICES (30 derniers jours, ' + invoices.length + ')'));
  if (invoices.length === 0) {
    console.log(c.dim + '   Aucune facture sur les 30 derniers jours.' + c.reset);
    console.log(c.dim + '   → Normal si tous tes abonnes sont en trial 7j (premiere facture J+7).' + c.reset);
  } else {
    const sorted = invoices.sort((a, b) => b.created - a.created);
    sorted.slice(0, 20).forEach((inv) => {
      const status = inv.status; // draft / open / paid / uncollectible / void
      const sc = status === 'paid' ? c.green
              : status === 'open' ? c.yellow
              : status === 'draft' ? c.dim
              : c.red;
      console.log('   [' + sc + pad(status, 7) + c.reset + '] '
        + pad(inv.id, 22) + ' · '
        + pad(fmt(inv.amount_due) + ' ' + inv.currency.toUpperCase(), 12) + ' · '
        + pad(dateFmt(inv.created), 12) + ' · '
        + (inv.customer_email || '?'));
    });
    if (invoices.length > 20) {
      console.log(c.dim + '   ... + ' + (invoices.length - 20) + ' autres' + c.reset);
    }
  }
  console.log('');

  // 7. MRR estime
  let mrrCents = 0;
  let mrrCurrency = 'EUR';
  buckets.active.forEach((e) => {
    const price = e.sub.items?.data?.[0]?.price;
    if (price?.recurring?.interval === 'month') mrrCents += price.unit_amount || 0;
    else if (price?.recurring?.interval === 'year') mrrCents += Math.round((price.unit_amount || 0) / 12);
    if (price?.currency) mrrCurrency = price.currency.toUpperCase();
  });
  let mrrTrialing = 0;
  buckets.trialing.forEach((e) => {
    const price = e.sub.items?.data?.[0]?.price;
    if (price?.recurring?.interval === 'month') mrrTrialing += price.unit_amount || 0;
    else if (price?.recurring?.interval === 'year') mrrTrialing += Math.round((price.unit_amount || 0) / 12);
  });

  console.log(head('💰 MRR'));
  console.log('   Active   : ' + c.green + c.bold + fmt(mrrCents) + ' ' + mrrCurrency + c.reset
    + c.dim + ' / mois (' + buckets.active.length + ' abos)' + c.reset);
  console.log('   Trialing : ' + c.yellow + fmt(mrrTrialing) + ' ' + mrrCurrency + c.reset
    + c.dim + ' / mois projete a J+7 (' + buckets.trialing.length + ' abos)' + c.reset);
  console.log('   ' + c.bold + 'Total potentiel : ' + fmt(mrrCents + mrrTrialing) + ' ' + mrrCurrency + ' / mois' + c.reset);
  console.log('');

  // 8. Hints
  if (buckets.trialing.length > 0) {
    console.log(c.yellow + '💡 Tu as ' + buckets.trialing.length + ' abonnes en trial 7j.' + c.reset);
    console.log(c.dim + '   → Stripe creera AUTOMATIQUEMENT la 1re facture a la fin du trial.' + c.reset);
    console.log(c.dim + '   → Pour finir un trial maintenant : Stripe Dashboard > Subscription > "End trial now"' + c.reset);
    console.log(c.dim + '   → Pour desactiver le trial sur les futurs checkouts : voir api/stripe-checkout.js ligne 84' + c.reset);
  }
  if (buckets.past_due.length > 0) {
    console.log(c.red + '⚠ ' + buckets.past_due.length + ' abonnement(s) past_due (paiement echoue).' + c.reset);
    console.log(c.dim + '   → Stripe Dashboard > Subscriptions > filtre past_due → relancer ou contacter le client.' + c.reset);
  }
  console.log('');
})().catch((err) => {
  console.error(c.red + '✗ Erreur:' + c.reset, err.message);
  if (err.code) console.error('   code: ' + err.code);
  process.exit(1);
});
