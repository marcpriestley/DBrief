import { webcrypto } from "node:crypto";
import http2 from "node:http2";
import { storage } from "./storage";

const { subtle } = webcrypto;

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

const APNS_HOST_SANDBOX = "https://api.sandbox.push.apple.com";
const APNS_HOST_PRODUCTION = "https://api.push.apple.com";

let cachedJwt: { token: string; issuedAt: number } | null = null;
let cachedCryptoKey: CryptoKey | null = null;
let cachedRawKey: string | null = null;

async function importApnsKey(pemKey: string): Promise<CryptoKey> {
  if (cachedCryptoKey && cachedRawKey === pemKey) return cachedCryptoKey;

  // Strip PEM headers/footers and decode base64
  const b64 = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const keyData = Buffer.from(b64, "base64");

  const key = await subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  cachedCryptoKey = key;
  cachedRawKey = pemKey;
  return key;
}

async function generateApnsJwt(keyId: string, teamId: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.issuedAt < 3000) {
    return cachedJwt.token;
  }

  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString("base64url");
  const signingInput = `${header}.${claims}`;

  const cryptoKey = await importApnsKey(privateKey);
  const signatureBuffer = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    Buffer.from(signingInput)
  );

  // Web Crypto returns IEEE-P1363 format — this is exactly what APNs expects
  const signature = Buffer.from(signatureBuffer).toString("base64url");
  const token = `${signingInput}.${signature}`;
  cachedJwt = { token, issuedAt: now };
  return token;
}

let h2Session: http2.ClientHttp2Session | null = null;
let h2Host: string | null = null;

function getH2Session(host: string): http2.ClientHttp2Session {
  if (h2Session && !h2Session.destroyed && h2Host === host) {
    return h2Session;
  }
  if (h2Session && !h2Session.destroyed) h2Session.destroy();
  h2Session = http2.connect(host);
  h2Host = host;
  h2Session.on("error", () => { h2Session = null; h2Host = null; });
  h2Session.on("close", () => { h2Session = null; h2Host = null; });
  return h2Session;
}

export async function sendApnsNotification(
  deviceToken: string,
  payload: PushNotificationPayload
): Promise<boolean> {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const rawKey = process.env.APNS_AUTH_KEY;

  if (!keyId || !teamId || !rawKey) {
    console.log("[APNs] Missing credentials — skipping");
    return false;
  }

  const privateKey = rawKey.replace(/\\n/g, "\n");
  const useProduction = process.env.APNS_PRODUCTION === "true";
  const host = useProduction ? APNS_HOST_PRODUCTION : APNS_HOST_SANDBOX;
  const bundleId = "com.dbrief.app";

  let jwt: string;
  try {
    jwt = await generateApnsJwt(keyId, teamId, privateKey);
  } catch (err) {
    console.error("[APNs] JWT signing failed:", err);
    return false;
  }

  const apnsPayload = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      badge: 1,
    },
    ...(payload.url ? { url: payload.url } : {}),
  });

  return new Promise((resolve) => {
    try {
      const session = getH2Session(host);
      const req = session.request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        ":scheme": "https",
        ":authority": new URL(host).hostname,
        "authorization": `bearer ${jwt}`,
        "apns-topic": bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(apnsPayload).toString(),
      });

      let responseData = "";
      let statusCode = 0;

      req.on("response", (headers) => {
        statusCode = headers[":status"] as number;
      });

      req.on("data", (chunk) => { responseData += chunk; });

      req.on("end", async () => {
        if (statusCode === 200) {
          console.log(`[APNs] Sent successfully to ${deviceToken.slice(0, 10)}…`);
          resolve(true);
        } else {
          let reason = "unknown";
          try { reason = JSON.parse(responseData).reason || reason; } catch {}
          console.error(`[APNs] Send failed — HTTP ${statusCode} reason=${reason}`);
          if (reason === "BadDeviceToken" || reason === "Unregistered") {
            await storage.deleteApnsToken(deviceToken).catch(() => {});
          }
          resolve(false);
        }
      });

      req.on("error", (err) => {
        console.error("[APNs] Request error:", err);
        h2Session = null;
        resolve(false);
      });

      req.write(apnsPayload);
      req.end();
    } catch (err) {
      console.error("[APNs] Failed to send:", err);
      resolve(false);
    }
  });
}

export function isApnsConfigured(): boolean {
  return !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_AUTH_KEY);
}
