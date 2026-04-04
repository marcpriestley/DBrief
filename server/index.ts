import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startNotificationScheduler } from "./notifications";
import { clearApnsCache } from "./apns";
import { storage } from "./storage";
import { pool } from "./db";

const PgSession = connectPgSimple(session);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || "dbrief-session-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

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

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Force no-cache on HTML so WKWebView (Capacitor) always fetches the latest JS bundle
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api") && !req.path.match(/\.(js|css|png|jpg|svg|woff|woff2|ico)$/)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    next();
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
