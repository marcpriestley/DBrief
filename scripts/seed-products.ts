import { getUncachableStripeClient } from './stripeClient';

async function createProducts() {
  const stripe = await getUncachableStripeClient();
  console.log('Checking for existing DBrief Premium product…');

  const existing = await stripe.products.search({ query: "name:'DBrief Premium' AND active:'true'" });
  if (existing.data.length > 0) {
    const prod = existing.data[0];
    console.log(`DBrief Premium already exists: ${prod.id}`);
    const prices = await stripe.prices.list({ product: prod.id, active: true });
    prices.data.forEach(p => {
      console.log(`  Price: ${p.id} — ${p.unit_amount} ${p.currency} / ${(p.recurring as any)?.interval ?? 'one-time'}`);
    });
    return;
  }

  console.log('Creating DBrief Premium product…');
  const product = await stripe.products.create({
    name: 'DBrief Premium',
    description: 'Voice Notes, Team section, Weekly Race Report, Data Pattern Analysis, and Mission Intelligence. Introductory offer — limited time.',
    metadata: { app: 'dbrief', tier: 'premium' },
  });
  console.log(`Created product: ${product.id}`);

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: 599,
    currency: 'gbp',
    recurring: { interval: 'month' },
    metadata: { label: 'introductory' },
  });
  console.log(`Created price: ${price.id} — £5.99/month`);
  console.log('Done. Webhooks will sync this to the database automatically.');
}

createProducts().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
