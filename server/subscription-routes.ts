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
  <button class="btn" onclick="window.close()">Return to DBrief</button>
  <p class="hint" id="hint" style="display:none">
    Tap <strong>Done</strong> or <strong>✕</strong> at the top of the screen to return.
  </p>
  <script>
    // Try programmatic close first — works when Capacitor opened this in an overlay WebView.
    // If the window is still open after a short delay, show a manual instruction instead.
    try { window.close(); } catch(e) {}
    setTimeout(function() {
      // If we're still here, window.close() was blocked (external browser).
      // Show the manual "tap Done" hint so the user knows what to do.
      var hint = document.getElementById('hint');
      if (hint) hint.style.display = 'block';
    }, 600);
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

  // ── POST /api/subscription/checkout-embedded ─────────────────────────────
  // Returns a Stripe Checkout clientSecret for Embedded Checkout (ui_mode='embedded').
  // The checkout form renders inside the native app — no external browser needed.
  app.post("/api/subscription/checkout-embedded", async (req, res) => {
    try {
      const userId = getUserId(req);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return res.status(404).json({ message: "User not found" });

      const stripe = await getUncachableStripeClient();

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.username,
          name: user.displayName ?? user.username,
          metadata: { userId: String(user.id) },
        });
        customerId = customer.id;
        await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
      }

      const products = await stripe.products.search({ query: "name:'DBrief Premium' AND active:'true'" });
      const product = products.data[0];
      if (!product) return res.status(503).json({ message: "Premium plan not available yet." });
      const prices = await stripe.prices.list({ product: product.id, active: true, limit: 1 });
      const price = prices.data[0];
      if (!price) return res.status(503).json({ message: "Premium plan not available yet." });

      const host = req.headers.host ?? process.env.REPLIT_DOMAINS?.split(',')[0] ?? 'localhost:5000';
      const protocol = host.startsWith('localhost') ? 'http' : 'https';
      const returnUrl = `${protocol}://${host}/checkout-return?result=success`;

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: price.id, quantity: 1 }],
        mode: 'subscription',
        ui_mode: 'embedded',
        return_url: returnUrl,
        allow_promotion_codes: true,
      });

      res.json({ clientSecret: session.client_secret });
    } catch (err: any) {
      console.error('[Stripe] Embedded checkout error:', err);
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

      // Find or create Stripe customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.username,
          name: user.displayName ?? user.username,
          metadata: { userId: String(user.id) },
        });
        customerId = customer.id;
        await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
      }

      // Find DBrief Premium price from Stripe (searches by product name)
      const products = await stripe.products.search({ query: "name:'DBrief Premium' AND active:'true'" });
      const product = products.data[0];
      if (!product) {
        return res.status(503).json({ message: "Premium plan not available yet — please try again shortly." });
      }
      const prices = await stripe.prices.list({ product: product.id, active: true, limit: 1 });
      const price = prices.data[0];
      if (!price) {
        return res.status(503).json({ message: "Premium plan not available yet — please try again shortly." });
      }

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
        line_items: [{ price: price.id, quantity: 1 }],
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
      const subscriptions = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: 'all',
        limit: 5,
      });

      // Find the most relevant subscription
      const active = subscriptions.data.find(s => s.status === 'active' || s.status === 'trialing');
      const latest = subscriptions.data[0]; // most recent regardless of status

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
        // Past due or other — keep current status
        newStatus = user.subscriptionStatus ?? 'free';
      }

      // Only update if status has actually changed (don't touch beta users)
      if (user.subscriptionStatus !== 'beta' && user.subscriptionStatus !== newStatus) {
        await db.update(users)
          .set({ subscriptionStatus: newStatus, ...(periodEnd ? { subscriptionCurrentPeriodEnd: periodEnd } : {}) })
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
