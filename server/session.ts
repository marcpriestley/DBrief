import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";

const PgSession = connectPgSimple(session);

const FALLBACK_SECRET = "dbrief-session-secret-key";
const sessionSecret = process.env.SESSION_SECRET || FALLBACK_SECRET;

if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === "production") {
    // In production this is a critical misconfiguration — all existing sessions
    // would be invalidated on every restart because the secret would be the same
    // hardcoded string, but more importantly it's guessable. Crash loudly.
    throw new Error(
      "[session] SESSION_SECRET env var is not set. " +
      "This is required in production. Set it via Replit Secrets."
    );
  } else {
    console.warn(
      "[session] SESSION_SECRET not set — using insecure default. " +
      "Set SESSION_SECRET in Replit Secrets before deploying."
    );
  }
}

export const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    // SameSite=none is required for Capacitor Android, where the WebView origin is
    // https://localhost (cross-origin relative to the deployed API server).
    // Requires secure:true — only applied in production.
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  },
});
