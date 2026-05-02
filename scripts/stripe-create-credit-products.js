#!/usr/bin/env node
// scripts/stripe-create-credit-products.js · FragValue
//
// Cree (ou recupere si deja existants) les 2 Products + Prices Stripe pour
// les packs de credits Coach IA. Idempotent : peut etre relance sans risque.
//
// USAGE
//   STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe-create-credit-products.js
//
// OUTPUT
//   Affiche les Price IDs a copier dans Vercel Environment Variables :
//     STRIPE_PRICE_COACH_PACK_50  = price_xxx
//     STRIPE_PRICE_COACH_PACK_200 = price_yyy
//
// IDEMPOTENCE
//   On utilise lookup_keys uniques pour les Prices :
//     coach_pack_50_v1, coach_pack_200_v1
//   Si un Price existe deja avec ce lookup_key, on le reutilise au lieu d'en
//   creer un nouveau (evite les doublons en dev / re-execution).

const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('✗ STRIPE_SECRET_KEY manquant.');
  console.error('  Lance avec : STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe-create-credit-products.js');
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const isLive = process.env.STRIPE_SECRET_KEY.startsWith('sk_live_');

const PACKS = [
  {
    key:           'pack_50',
    lookup_key:    'coach_pack_50_v1',
    product_name:  'Pack 50 credits Coach IA',
    description:   '50 messages supplementaires avec le Coach IA Conversational FragValue. Validite 90 jours apres achat. Utilisable au-dela des limites quotidiennes Pro (5/jour) et Elite (30/jour).',
    amount_cents:  400,   // 4 EUR
    currency:      'eur',
    metadata:      { credits: '50', validity_days: '90', source: 'coach_credits' },
  },
  {
    key:           'pack_200',
    lookup_key:    'coach_pack_200_v1',
    product_name:  'Pack 200 credits Coach IA',
    description:   '200 messages supplementaires avec le Coach IA Conversational FragValue. Meilleur rapport qualite/prix. Validite 90 jours apres achat. Utilisable au-dela des limites quotidiennes Pro (5/jour) et Elite (30/jour).',
    amount_cents:  1200,  // 12 EUR
    currency:      'eur',
    metadata:      { credits: '200', validity_days: '90', source: 'coach_credits' },
  },
];

async function findExistingPrice(lookupKey) {
  const list = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  return list.data[0] || null;
}

async function findOrCreateProduct(pack) {
  // Cherche un product existant via metadata.source + metadata.credits
  const existing = await stripe.products.search({
    query: `metadata['source']:'coach_credits' AND metadata['credits']:'${pack.metadata.credits}' AND active:'true'`,
    limit: 1,
  });
  if (existing.data[0]) {
    console.log(`  ↻ Product existant trouve : ${existing.data[0].id} (${existing.data[0].name})`);
    return existing.data[0];
  }

  // Sinon, cree
  const product = await stripe.products.create({
    name:        pack.product_name,
    description: pack.description,
    metadata:    pack.metadata,
    tax_code:    'txcd_10000000', // SaaS / digital service
  });
  console.log(`  + Product cree : ${product.id} (${product.name})`);
  return product;
}

async function findOrCreatePrice(product, pack) {
  // Cherche un price existant via lookup_key
  const existing = await findExistingPrice(pack.lookup_key);
  if (existing) {
    if (existing.product === product.id && existing.unit_amount === pack.amount_cents) {
      console.log(`  ↻ Price existant trouve : ${existing.id} (${(existing.unit_amount / 100).toFixed(2)} ${existing.currency.toUpperCase()})`);
      return existing;
    }
    console.warn(`  ⚠ Price avec lookup_key ${pack.lookup_key} existe mais pointe vers un autre product ou montant.`);
    console.warn(`    Existing: product=${existing.product} amount=${existing.unit_amount}`);
    console.warn(`    Wanted  : product=${product.id} amount=${pack.amount_cents}`);
    console.warn(`    Cree un nouveau Price avec lookup_key versionne.`);
  }

  // Sinon cree
  const price = await stripe.prices.create({
    product:      product.id,
    unit_amount:  pack.amount_cents,
    currency:     pack.currency,
    lookup_key:   pack.lookup_key,
    nickname:     pack.product_name,
    tax_behavior: 'inclusive', // FR : prix TTC
    metadata:     pack.metadata,
  });
  console.log(`  + Price cree : ${price.id} (${(price.unit_amount / 100).toFixed(2)} ${price.currency.toUpperCase()}, lookup=${price.lookup_key})`);
  return price;
}

async function main() {
  console.log(`\n🛒 FragValue · Creation Products+Prices Coach IA Credits  [${isLive ? 'LIVE' : 'TEST'} MODE]\n`);

  const account = await stripe.accounts.retrieve();
  console.log(`   Compte : ${account.business_profile?.name || account.email} (${account.country})\n`);

  const results = {};
  for (const pack of PACKS) {
    console.log(`\n─── ${pack.product_name} ───`);
    const product = await findOrCreateProduct(pack);
    const price   = await findOrCreatePrice(product, pack);
    results[pack.key] = {
      product_id: product.id,
      price_id:   price.id,
      amount_eur: pack.amount_cents / 100,
    };
  }

  console.log(`\n\n══════════════════════════════════════════════════════════`);
  console.log(`✅ Setup termine. Copie ces variables dans Vercel Environment :`);
  console.log(`══════════════════════════════════════════════════════════\n`);
  console.log(`STRIPE_PRICE_COACH_PACK_50  = ${results.pack_50.price_id}`);
  console.log(`STRIPE_PRICE_COACH_PACK_200 = ${results.pack_200.price_id}\n`);
  console.log(`Vercel Dashboard :`);
  console.log(`  https://vercel.com → frag-value → Settings → Environment Variables`);
  console.log(`  Apres save, redeploy : Deployments → ⋯ → Redeploy\n`);
  console.log(`Test manuel :`);
  console.log(`  curl -X POST https://fragvalue.com/api/coach-credits-purchase \\`);
  console.log(`    -H "Authorization: Bearer YOUR_SUPABASE_TOKEN" \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"pack":"pack_50"}'\n`);
}

main().catch(err => {
  console.error('\n✗ Erreur :', err.message);
  if (err.raw) console.error(err.raw);
  process.exit(1);
});
