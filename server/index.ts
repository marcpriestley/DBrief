import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startNotificationScheduler } from "./notifications";
import { clearApnsCache } from "./apns";
import { storage } from "./storage";
import { sessionMiddleware } from "./session";
import { WebhookHandlers } from "./webhookHandlers";

const app = express();
// Trust the first reverse-proxy hop (Replit's load balancer) so express-rate-limit
// can read the real client IP from X-Forwarded-For without validation warnings.
app.set("trust proxy", 1);

// ── CORS for Capacitor native apps ────────────────────────────────────────────
// On Android the WebView origin is https://localhost (the Capacitor bridge),
// not the remote server URL. This middleware adds the headers that allow the
// native app to make cross-origin API requests with session cookies.
const NATIVE_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost"];
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (origin && NATIVE_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
  }
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// ── Stripe webhook — MUST be registered BEFORE express.json() ─────────────
// Stripe webhooks require the raw Buffer body for signature verification.
// Registering after express.json() would parse the body as JSON, breaking verification.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing stripe-signature' });
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: any) {
      console.error('[Stripe] Webhook error:', err.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Stable identifier for this server deployment — changes every time the server starts
// (i.e. on every Replit deploy). In development, we use "dev" so constant HMR restarts
// never trigger client reloads. The client compares this against its cached value and
// forces a hard navigation reload when the value has changed, busting WKWebView's disk cache.
const BUILD_ID = process.env.NODE_ENV === "production"
  ? `${Date.now()}`
  : "dev";

app.get("/api/version", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json({ version: BUILD_ID });
});

// Lightweight public endpoint for keepalive pings — no DB hit, no auth required.
// Point an uptime monitor (e.g. UptimeRobot) at /api/ping every 5 minutes
// to prevent cold-start delays for users.
app.get("/api/ping", (_req, res) => res.json({ ok: true }));

// Force no-cache on HTML so WKWebView (Capacitor) always fetches the latest JS bundle.
// Must be registered before session middleware and routes so headers are set before
// any other handler can short-circuit the response (e.g. static file serving).
app.use((req, res, next) => {
  if (!req.path.startsWith("/api") && !req.path.match(/\.(js|css|png|jpg|jpeg|svg|woff|woff2|ico|webp)$/)) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

app.use(sessionMiddleware);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// ── Health check — used by load balancers and uptime monitors ────────────────
// No auth required. Returns 200 while the server is accepting requests.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: Math.floor(process.uptime()) });
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    if (status >= 500) console.error("[server] unhandled error:", err);
    if (!res.headersSent) res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    
    // Start notification scheduler after server is running
    startNotificationScheduler();

    // Initialize Stripe schema and sync — non-blocking so startup isn't delayed
    // if Stripe is temporarily unreachable.
    (async () => {
      try {
        const { runMigrations } = await import('stripe-replit-sync');
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) throw new Error('DATABASE_URL required');
        await runMigrations({ databaseUrl });
        const { getStripeSync } = await import('./stripeClient');
        const stripeSync = await getStripeSync();

        // Only register/manage webhooks in production — the dev server running
        // findOrCreateManagedWebhook would treat the prod webhook as "orphaned"
        // and delete it, causing all production webhook events to be lost.
        if (process.env.REPLIT_DEPLOYMENT === '1') {
          const webhookBase = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
          await stripeSync.findOrCreateManagedWebhook(`${webhookBase}/api/stripe/webhook`);
          stripeSync.syncBackfill().catch((e: any) => log(`[Stripe] Backfill error: ${e.message}`));
        }

        log('[Stripe] Initialized');

        // Warm up the premium price cache — runs once at startup so the first
        // checkout request is instant and there are no race conditions.
        const { warmupStripePremiumPrice } = await import('./subscription-routes');
        warmupStripePremiumPrice();
      } catch (e: any) {
        log(`[Stripe] Init error (non-fatal): ${e.message}`);
      }
    })();

    // Seed APNs credentials into server_config from env vars on startup
    // This ensures production DB always has the correct values even if env var APNS_TEAM_ID is broken
    (async () => {
      try {
        const envKeyId = "FNNGQ5YY6H"; // Known correct Key ID
        const envTeamId = "5T4F8AH2ZV"; // Known correct Team ID
        const envAuthKey = process.env.APNS_AUTH_KEY;
        if (envAuthKey && envAuthKey.includes("BEGIN PRIVATE KEY")) {
          await storage.setServerConfig("apns_key_id", envKeyId);
          await storage.setServerConfig("apns_team_id", envTeamId);
          await storage.setServerConfig("apns_auth_key", envAuthKey.trim());
          clearApnsCache();
          log("[APNs] Credentials seeded into DB from startup");
        }
      } catch (err) {
        log(`[APNs] Startup seed failed: ${err}`);
      }
    })();
  });
})();
