import { createSign } from "node:crypto";

// ── Firebase service account config ──────────────────────────────────────────
interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function getFcmConfig(): FcmConfig | null {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

export function isFcmConfigured(): boolean {
  return !!getFcmConfig();
}

// ── JWT / OAuth2 access token (cached up to 55 min) ───────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null;

function makeJwt(cfg: FcmConfig): string {
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss:   cfg.clientEmail,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud:   "https://oauth2.googleapis.com/token",
    exp:   now + 3600,
    iat:   now,
  })).toString("base64url");
  const unsigned  = `${header}.${payload}`;
  const signer    = createSign("SHA256");
  signer.update(unsigned);
  const sig = signer.sign(cfg.privateKey, "base64url");
  return `${unsigned}.${sig}`;
}

async function getAccessToken(cfg: FcmConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const jwt = makeJwt(cfg);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  });
  if (!res.ok) throw new Error(`[FCM] OAuth2 token error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

// ── Public API ────────────────────────────────────────────────────────────────
export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendFcmNotification(fcmToken: string, payload: FcmPayload): Promise<void> {
  const cfg = getFcmConfig();
  if (!cfg) {
    console.warn("[FCM] Not configured — set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY");
    return;
  }
  try {
    const accessToken = await getAccessToken(cfg);
    const url = `https://fcm.googleapis.com/v1/projects/${cfg.projectId}/messages:send`;
    const body = {
      message: {
        token: fcmToken,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
        android: { notification: { sound: "default", channel_id: "dbrief_default" } },
      },
    };
    const res = await fetch(url, {
      method:  "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) cachedToken = null;
      console.error("[FCM] Send error:", res.status, text);
      throw new Error(`FCM send failed: ${res.status}`);
    }
    console.log("[FCM] Sent to:", fcmToken.substring(0, 12) + "...");
  } catch (err) {
    console.error("[FCM] Notification error:", err);
    throw err;
  }
}
