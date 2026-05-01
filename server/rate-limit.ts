import rateLimit from "express-rate-limit";

// ── Auth endpoints — brute-force protection ───────────────────────────────────
// 10 attempts per 15 minutes per IP (login / register)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again in 15 minutes." },
  skip: () => process.env.NODE_ENV === "test",
});

// ── AI-backed endpoints — cost protection ─────────────────────────────────────
// 60 requests per hour per user (debrief messages, insights, weekly reports, patterns)
// Keyed by user session ID so authenticated users share one bucket regardless of IP
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // When the user is logged in key by their DB user ID, otherwise fall through
  // to the default IP-based key (no custom keyGenerator = no IPv6 warning)
  skip: (req) => {
    // Rate-limit unauthenticated requests via the general IP limiter only
    const userId = (req.session as any)?.userId;
    return !userId || process.env.NODE_ENV === "test";
  },
  keyGenerator: (req) => `user_${(req.session as any)?.userId}`,
  message: { message: "AI request limit reached. Please wait before sending more messages." },
});

// ── General API — DDoS / abuse protection ────────────────────────────────────
// 200 requests per 15 minutes per IP
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please slow down." },
  skip: () => process.env.NODE_ENV === "test",
});

// ── Checkout signal — fraud / enumeration protection ─────────────────────────
// The checkout-signal endpoint is unauthenticated (it's called from a browser
// redirect page before the app has re-hydrated). Stripe session IDs are
// cryptographically unpredictable, but we still limit probing attempts.
// 10 requests per minute per IP.
export const checkoutSignalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many checkout requests. Please try again shortly." },
  skip: () => process.env.NODE_ENV === "test",
});
