import { p256 } from "@noble/curves/nist.js";
import http2 from "node:http2";
import { storage } from "./storage";

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

const APNS_HOST_SANDBOX = "https://api.sandbox.push.apple.com";
const APNS_HOST_PRODUCTION = "https://api.push.apple.com";

let cachedJwt: { token: string; issuedAt: number } | null = null;
let cachedPrivKey: Uint8Array | null = null;
let cachedRawKey: string | null = null;

// --- Minimal DER reader to extract the raw 32-byte P-256 private key from PKCS#8 ---

function readLength(der: Buffer, pos: number): { len: number; consumed: number } {
  if (der[pos] < 0x80) return { len: der[pos], consumed: 1 };
  const numBytes = der[pos] & 0x7f;
  let len = 0;
  for (let i = 1; i <= numBytes; i++) len = (len << 8) | der[pos + i];
  return { len, consumed: 1 + numBytes };
}

function extractP256PrivateKey(pem: string): Uint8Array {
  // Strip PEM headers and decode base64 — handle both actual newlines and literal \n
  const b64 = pem
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(b64, "base64");

  let pos = 0;

  // outer SEQUENCE
  pos++; // tag 0x30
  const outerLen = readLength(der, pos);
  pos += outerLen.consumed;

  // version INTEGER
  pos++; // tag 0x02
  const verLen = readLength(der, pos);
  pos += verLen.consumed + verLen.len;

  // algorithm SEQUENCE
  pos++; // tag 0x30
  const algLen = readLength(der, pos);
  pos += algLen.consumed + algLen.len;

  // privateKey OCTET STRING (contains SEC1)
  pos++; // tag 0x04
  const pkOctetLen = readLength(der, pos);
  pos += pkOctetLen.consumed;

  // SEC1 SEQUENCE
  pos++; // tag 0x30
  const sec1Len = readLength(der, pos);
  pos += sec1Len.consumed;

  // SEC1 version INTEGER (= 1)
  pos++; // tag 0x02
  const sec1VerLen = readLength(der, pos);
  pos += sec1VerLen.consumed + sec1VerLen.len;

  // private key OCTET STRING — this is the 32-byte key
  pos++; // tag 0x04
  const keyLen = readLength(der, pos);
  pos += keyLen.consumed;

  return new Uint8Array(der.slice(pos, pos + keyLen.len));
}

function loadPrivateKey(pemKey: string): Uint8Array {
  if (cachedPrivKey && cachedRawKey === pemKey) return cachedPrivKey;
  const key = extractP256PrivateKey(pemKey);
  if (key.length !== 32) throw new Error(`Expected 32-byte P-256 key, got ${key.length} bytes`);
  cachedPrivKey = key;
  cachedRawKey = pemKey;
  return key;
}

// --- JWT generation using pure-JS p256 signing ---

function generateApnsJwt(keyId: string, teamId: string, privateKey: Uint8Array): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.issuedAt < 3000) return cachedJwt.token;

  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString("base64url");
  const signingInput = `${header}.${claims}`;

  // p256.sign returns a 64-byte Uint8Array (r || s compact format) — exactly what APNs needs
  const msgHash = Buffer.from(signingInput);
  const sig = p256.sign(msgHash, privateKey, { lowS: true, prehash: true });
  const signature = Buffer.from(sig).toString("base64url");

  const token = `${signingInput}.${signature}`;
  cachedJwt = { token, issuedAt: now };
  return token;
}

// --- HTTP/2 APNs connection ---

let h2Session: http2.ClientHttp2Session | null = null;
let h2Host: string | null = null;

function getH2Session(host: string): http2.ClientHttp2Session {
  if (h2Session && !h2Session.destroyed && h2Host === host) return h2Session;
  if (h2Session && !h2Session.destroyed) h2Session.destroy();
  h2Session = http2.connect(host);
  h2Host = host;
  h2Session.on("error", () => { h2Session = null; h2Host = null; });
  h2Session.on("close", () => { h2Session = null; h2Host = null; });
  return h2Session;
}

// --- Public API ---

async function getApnsCredentials(): Promise<{ keyId: string; teamId: string; rawKey: string } | null> {
  // Try DB first, fall back to env vars
  let dbKeyId: string | undefined, dbTeamId: string | undefined, dbAuthKey: string | undefined;
  try {
    [dbKeyId, dbTeamId, dbAuthKey] = await Promise.all([
      storage.getServerConfig("apns_key_id"),
      storage.getServerConfig("apns_team_id"),
      storage.getServerConfig("apns_auth_key"),
    ]);
    console.log(`[APNs] DB creds — keyId=${dbKeyId || "none"} teamId=${dbTeamId || "none"} authKeyLen=${dbAuthKey?.length ?? 0}`);
  } catch (err) {
    console.error("[APNs] DB config read failed:", err);
  }
  const keyId = dbKeyId || process.env.APNS_KEY_ID;
  const teamId = dbTeamId || process.env.APNS_TEAM_ID;
  const rawKey = dbAuthKey || process.env.APNS_AUTH_KEY;
  console.log(`[APNs] Using — keyId=${keyId} teamIdLen=${teamId?.length} rawKeyLen=${rawKey?.length}`);
  if (!keyId || !teamId || !rawKey) return null;
  return { keyId, teamId, rawKey };
}

export async function sendApnsNotification(
  deviceToken: string,
  payload: PushNotificationPayload
): Promise<boolean> {
  const creds = await getApnsCredentials();
  const keyId = creds?.keyId;
  const teamId = creds?.teamId;
  const rawKey = creds?.rawKey;

  if (!keyId || !teamId || !rawKey) {
    console.log("[APNs] Missing credentials — skipping");
    return false;
  }

  const pemKey = rawKey.replace(/\\n/g, "\n");
  const useProduction = process.env.APNS_PRODUCTION === "true";
  const host = useProduction ? APNS_HOST_PRODUCTION : APNS_HOST_SANDBOX;
  const bundleId = "com.dbrief.app";

  console.log(`[APNs] Sending to ${deviceToken.slice(0, 10)}… env=${useProduction ? "production" : "sandbox"} keyLen=${pemKey.length}`);

  let jwt: string;
  try {
    const privKey = loadPrivateKey(pemKey);
    jwt = generateApnsJwt(keyId, teamId, privKey);
    console.log("[APNs] JWT generated OK");
  } catch (err) {
    console.error("[APNs] JWT generation failed:", err);
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

      req.on("response", (headers) => { statusCode = headers[":status"] as number; });
      req.on("data", (chunk) => { responseData += chunk; });
      req.on("end", async () => {
        if (statusCode === 200) {
          console.log(`[APNs] Delivered successfully to ${deviceToken.slice(0, 10)}…`);
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
      console.error("[APNs] Failed to create request:", err);
      resolve(false);
    }
  });
}

export function isApnsConfigured(): boolean {
  return !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_AUTH_KEY);
}

export function clearApnsCache(): void {
  cachedJwt = null;
  cachedPrivKey = null;
  cachedRawKey = null;
  if (h2Session && !h2Session.destroyed) h2Session.destroy();
  h2Session = null;
  h2Host = null;
}
