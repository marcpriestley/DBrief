import type { Express } from "express";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { sql } from "drizzle-orm";

function getUserId(req: any): number {
  const id = (req.session as any)?.userId;
  if (!id) throw Object.assign(new Error("Not authenticated"), { status: 401 });
  return id;
}

// Returns a valid Stripe customer ID for the user in the current Stripe mode.
// If the stored ID belongs to a different mode (e.g. test vs live), it creates a fresh one.
async function getOrCreateStripeCustomer(
  stripe: import('stripe').default,
  user: { id: number; username: string; displayName: string | null; stripeCustomerId: string | null }
): Promise<string> {
  if (user.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(user.stripeCustomerId);
      if (!('deleted' in existing)) return existing.id;
    } catch (e: any) {
      // "No such customer" — stale ID from wrong Stripe mode; fall through to create new
      console.warn(`[Stripe] Stale customer ID ${user.stripeCustomerId}, creating fresh one:`, e.message);
    }
  }
  const customer = await stripe.customers.create({
    email: user.username,
    name: user.displayName ?? user.username,
    metadata: { userId: String(user.id) },
  });
  await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, user.id));
  console.log(`[Stripe] Created customer ${customer.id} for user ${user.id}`);
  return customer.id;
}

// ── Stripe Premium Price — singleton cache ────────────────────────────────────
// The promise is created once at startup (via warmupStripePremiumPrice) and
// shared by all callers. Concurrent requests race to the same Promise so Stripe
// is only called once — no duplicates, no race conditions.
let _priceIdPromise: Promise<string> | null = null;

async function _findOrCreatePremiumPrice(): Promise<string> {
  const stripe = await getUncachableStripeClient();

  // Log whether we're in test or live mode so it's obvious in production logs.
  const keyMode = (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live') ? 'LIVE' : 'TEST';
  console.log(`[Stripe] Resolving premium price (${keyMode} mode)...`);

  // 1. Try STRIPE_PRICE_ID env var — skip if it's from the wrong mode.
  const envPriceId = process.env.STRIPE_PRICE_ID;
  if (envPriceId) {
    try {
      const price = await stripe.prices.retrieve(envPriceId);
      if (price.active) {
        console.log(`[Stripe] Premium price from env: ${price.id}`);
        return price.id;
      }
    } catch (e: any) {
      console.warn(`[Stripe] STRIPE_PRICE_ID (${envPriceId}) not in ${keyMode} mode — will find/create.`);
    }
  }

  // 2. Find existing product by canonical name.
  const allProducts = await stripe.products.list({ active: true, limit: 100 });
  let product = allProducts.data.find(p => p.name === 'DBrief Premium');

  // 3. Create the product once if it doesn't exist in this mode.
  if (!product) {
    product = await stripe.products.create({
      name: 'DBrief Premium',
      description: 'Full access to all DBrief premium features — voice notes, squad, weekly reports, pattern analysis & mission intelligence.',
    });
    console.log(`[Stripe] Product created in ${keyMode} mode: ${product.id}`);
  }

  // 4. Find existing active price for this product.
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 1 });
  if (prices.data[0]) {
    console.log(`[Stripe] Premium price ready: ${prices.data[0].id} (${keyMode})`);
    return prices.data[0].id;
  }

  // 5. Create the £5.99/month price if it doesn't exist.
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: 599,
    currency: 'gbp',
    recurring: { interval: 'month' },
  });
  console.log(`[Stripe] Price created in ${keyMode} mode: ${price.id} — update STRIPE_PRICE_ID to this value`);
  return price.id;
}

/** Called once at server startup. Warms up the price cache so checkout is instant. */
export function warmupStripePremiumPrice(): void {
  if (!_priceIdPromise) {
    _priceIdPromise = _findOrCreatePremiumPrice().catch((e) => {
      console.error('[Stripe] Premium price warmup failed:', e.message);
      _priceIdPromise = null; // allow retry on next checkout attempt
      throw e;
    });
  }
}

/** Returns the cached price ID. Resolves immediately after warmup. */
async function getPremiumPriceId(): Promise<string> {
  if (!_priceIdPromise) warmupStripePremiumPrice();
  return _priceIdPromise!;
}

export function isPremiumStatus(status: string | null | undefined): boolean {
  return status === 'premium' || status === 'beta';
}

export function registerSubscriptionRoutes(app: Express) {

  // ── GET /checkout-return ──────────────────────────────────────────────────
  // Landing page for native (iOS + Android) Stripe checkout.
  // SFSafariViewController / Chrome Custom Tab redirect here after payment so
  // users see a clean "return to app" screen instead of the full web UI.
  app.get("/checkout-return", (req, res) => {
    const result = req.query.result as string;
    const success = result === 'success';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DBrief</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #141414; color: #f5f5f5;
      min-height: 100dvh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 2rem;
      text-align: center;
    }
    .icon { font-size: 3.5rem; margin-bottom: 1.25rem; }
    h1 { font-size: 1.5rem; font-weight: 800; margin-bottom: 0.5rem; }
    p { font-size: 0.95rem; color: #a3a3a3; line-height: 1.5; margin-bottom: 2rem; }
    .btn {
      display: inline-block; padding: 0.875rem 2rem;
      background: #d97706; color: #fff; border-radius: 0.75rem;
      font-size: 1rem; font-weight: 700; text-decoration: none;
      border: none; cursor: pointer; margin-bottom: 1rem;
    }
    .hint {
      font-size: 0.9rem; color: #a3a3a3; margin-top: 0.5rem;
      line-height: 1.5;
    }
    .hint strong { color: #f5f5f5; }
  </style>
</head>
<body>
  <div class="icon">${success ? '🏁' : '👋'}</div>
  <h1>${success ? 'You\'re on the grid.' : 'No worries.'}</h1>
  <p id="msg">${success
    ? 'Your DBrief Premium subscription is active.'
    : 'Your subscription was not started.'
  }</p>
  <button class="btn" id="returnBtn" onclick="goBack()">Return to DBrief</button>
  <p class="hint">Returning you to the app…</p>
  <script>
    var dest = ${success ? "'/?subscription=success'" : "'/?subscription=cancelled'"};
    function goBack() { window.location.href = dest; }
    // Auto-redirect after a short pause so the user can read the message.
    setTimeout(goBack, 2200);
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  // ── GET /api/subscription/status ─────────────────────────────────────────
  app.get("/api/subscription/status", async (req, res) => {
    try {
      const userId = getUserId(req);
      const [user] = await db.select({
        subscriptionStatus: users.subscriptionStatus,
        subscriptionCurrentPeriodEnd: users.subscriptionCurrentPeriodEnd,
      }).from(users).where(eq(users.id, userId));

      const status = user?.subscriptionStatus ?? 'free';
      res.json({
        status,
        isPremium: isPremiumStatus(status),
        currentPeriodEnd: user?.subscriptionCurrentPeriodEnd ?? null,
      });
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // ── GET /api/subscription/publishable-key ────────────────────────────────
  app.get("/api/subscription/publishable-key", async (_req, res) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/subscription/payment-link ───────────────────────────────────
  // Returns the Stripe Payment Link URL (supports Apple Pay, Klarna, etc.)
  // for use in native iOS via SFSafariViewController (Browser plugin).
  app.get("/api/subscription/payment-link", async (_req, res) => {
    try {
      // Allow override via env var for instant config without a deploy.
      if (process.env.STRIPE_PAYMENT_LINK_URL) {
        return res.json({ url: process.env.STRIPE_PAYMENT_LINK_URL });
      }
      const stripe = await getUncachableStripeClient();
      const priceId = await getPremiumPriceId();
      // Find the active payment link that uses the premium price.
      const links = await stripe.paymentLinks.list({ active: true, limit: 20 });
      let found: string | null = null;
      for (const link of links.data) {
        const items = await stripe.paymentLinks.listLineItems(link.id, { limit: 5 });
        if (items.data.some(i => i.price?.id === priceId)) {
          found = link.url;
          break;
        }
      }
      if (!found) return res.status(404).json({ message: "No active payment link found for this plan." });
      res.json({ url: found });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/subscription/checkout-embedded ─────────────────────────────
  // Returns a Stripe Checkout clientSecret for Embedded Checkout (ui_mode='embedded').
  // The checkout form renders inside the native app — no external browser needed.
  app.post("/api/subscription/checkout-embedded", async (req, res) => {
    try {
      const userId = getUserId(req);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return res.status(404).json({ message: "User not found" });

      const stripe = await getUncachableStripeClient();
      const customerId = await getOrCreateStripeCustomer(stripe, user);
      const priceId = await getPremiumPriceId();

      const host = req.headers.host ?? process.env.REPLIT_DOMAINS?.split(',')[0] ?? 'localhost:5000';
      const protocol = host.startsWith('localhost') ? 'http' : 'https';
      const returnUrl = `${protocol}://${host}/checkout-return?result=success`;

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        ui_mode: 'embedded',
        return_url: returnUrl,
        allow_promotion_codes: true,
      });

      res.json({ clientSecret: session.client_secret });
    } catch (err: any) {
      console.error('[Stripe] Embedded checkout error:', err.message, err.status);
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // ── POST /api/subscription/checkout ──────────────────────────────────────
  app.post("/api/subscription/checkout", async (req, res) => {
    try {
      const userId = getUserId(req);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return res.status(404).json({ message: "User not found" });

      const stripe = await getUncachableStripeClient();
      const customerId = await getOrCreateStripeCustomer(stripe, user);
      const priceId = await getPremiumPriceId();

      const host = req.headers.host ?? process.env.REPLIT_DOMAINS?.split(',')[0] ?? 'localhost:5000';
      const protocol = host.startsWith('localhost') ? 'http' : 'https';
      const baseUrl = `${protocol}://${host}`;

      // Native apps (iOS + Android) open Stripe in an in-app browser (SFSafariViewController /
      // Chrome Custom Tab). We redirect them to a lightweight close-page rather than the full
      // web app so users aren't confused by seeing the web UI inside the in-app browser.
      const isNative = req.body?.native === true;
      const successUrl = isNative
        ? `${baseUrl}/checkout-return?result=success`
        : `${baseUrl}/?subscription=success`;
      const cancelUrl = isNative
        ? `${baseUrl}/checkout-return?result=cancelled`
        : `${baseUrl}/?subscription=cancelled`;

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error('[Stripe] Checkout error:', err);
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // ── POST /api/subscription/sync ──────────────────────────────────────────
  // Reads the live subscription state from Stripe and updates the DB.
  // Called on app load so missed webhooks never leave users in wrong state.
  app.post("/api/subscription/sync", async (req, res) => {
    try {
      const userId = getUserId(req);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user?.stripeCustomerId) {
        // No Stripe customer yet — definitely free
        return res.json({ status: 'free', isPremium: false, synced: false });
      }

      const stripe = await getUncachableStripeClient();

      // Helper: resolve the most relevant status from a list of subscriptions
      function resolveStatus(subs: import('stripe').default.Subscription[], currentStatus: string): { newStatus: string; periodEnd: Date | null } {
        const active = subs.find(s => s.status === 'active' || s.status === 'trialing');
        const latest = subs[0];
        let newStatus: string;
        let periodEnd: Date | null = null;
        if (active) {
          newStatus = 'premium';
          periodEnd = active.current_period_end ? new Date(active.current_period_end * 1000) : null;
        } else if (latest && (latest.status === 'canceled' || latest.status === 'unpaid' || latest.status === 'incomplete_expired')) {
          newStatus = 'free';
        } else if (!latest) {
          newStatus = 'free';
        } else {
          newStatus = currentStatus ?? 'free';
        }
        return { newStatus, periodEnd };
      }

      // Primary lookup: by stored stripeCustomerId
      const subscriptions = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: 'all',
        limit: 5,
      });

      let { newStatus, periodEnd } = resolveStatus(subscriptions.data, user.subscriptionStatus ?? 'free');
      let healedCustomerId: string | null = null;

      // If we found no active subscription via the stored customer ID, search Stripe
      // by email. This heals users who paid via a payment link (which creates an
      // anonymous customer we couldn't pre-store) or had a stale customer ID.
      if (newStatus === 'free' && user.username) {
        const customers = await stripe.customers.search({
          query: `email:"${user.username}"`,
          limit: 5,
        });
        for (const cust of customers.data) {
          if (cust.id === user.stripeCustomerId) continue; // already checked
          const custSubs = await stripe.subscriptions.list({
            customer: cust.id,
            status: 'all',
            limit: 5,
          });
          const resolved = resolveStatus(custSubs.data, 'free');
          if (resolved.newStatus === 'premium') {
            newStatus = 'premium';
            periodEnd = resolved.periodEnd;
            healedCustomerId = cust.id; // we'll store this as the canonical customer ID
            console.log(`[Stripe] Sync — healed user ${userId}: found active subscription under email-matched customer ${cust.id}`);
            break;
          }
        }
      }

      // Only update if status has actually changed (don't touch beta users)
      if (user.subscriptionStatus !== 'beta' && (user.subscriptionStatus !== newStatus || healedCustomerId)) {
        await db.update(users)
          .set({
            subscriptionStatus: newStatus,
            ...(healedCustomerId ? { stripeCustomerId: healedCustomerId } : {}),
            ...(periodEnd ? { subscriptionCurrentPeriodEnd: periodEnd } : {}),
          })
          .where(eq(users.id, userId));
        console.log(`[Stripe] Sync — user ${userId}: ${user.subscriptionStatus} -> ${newStatus}`);
      }

      const finalStatus = user.subscriptionStatus === 'beta' ? 'beta' : newStatus;
      res.json({ status: finalStatus, isPremium: isPremiumStatus(finalStatus), synced: true });
    } catch (err: any) {
      console.error('[Stripe] Sync error:', err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/subscription/portal ────────────────────────────────────────
  app.post("/api/subscription/portal", async (req, res) => {
    try {
      const userId = getUserId(req);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user?.stripeCustomerId) {
        return res.status(400).json({ message: "No subscription found" });
      }

      const stripe = await getUncachableStripeClient();
      const host = req.headers.host ?? process.env.REPLIT_DOMAINS?.split(',')[0] ?? 'localhost:5000';
      const protocol = host.startsWith('localhost') ? 'http' : 'https';

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${protocol}://${host}/`,
      });

      res.json({ url: portalSession.url });
    } catch (err: any) {
      console.error('[Stripe] Portal error:', err);
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // ── POST /api/admin/grant-beta ────────────────────────────────────────────
  // Allows granting or revoking beta (free premium) access for any user.
  // Protected by ADMIN_CODE env var.
  app.post("/api/admin/grant-beta", async (req, res) => {
    try {
      const { username, grant, adminCode } = req.body;
      const expectedCode = process.env.ADMIN_CODE;

      if (!expectedCode || adminCode !== expectedCode) {
        return res.status(403).json({ message: "Invalid admin code" });
      }
      if (!username) {
        return res.status(400).json({ message: "username required" });
      }

      const newStatus = grant !== false ? 'beta' : 'free';
      const result = await db.update(users)
        .set({ subscriptionStatus: newStatus })
        .where(eq(users.username, username))
        .returning({ id: users.id, username: users.username, subscriptionStatus: users.subscriptionStatus });

      if (!result.length) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: `User ${username} subscription set to '${newStatus}'`, user: result[0] });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/admin/users ──────────────────────────────────────────────────
  app.get("/api/admin/users", async (req, res) => {
    try {
      const { adminCode } = req.query as any;
      const expectedCode = process.env.ADMIN_CODE;
      if (!expectedCode || adminCode !== expectedCode) {
        return res.status(403).json({ message: "Invalid admin code" });
      }

      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        subscriptionStatus: users.subscriptionStatus,
        stripeCustomerId: users.stripeCustomerId,
      }).from(users).orderBy(users.id);

      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
