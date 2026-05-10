import { createHmac } from "crypto";

const _secret = process.env.SESSION_SECRET ?? "dbrief-session-secret-key";

export function generateCheckoutToken(userId: number): string {
  const slot = Math.floor(Date.now() / 3_600_000);
  return createHmac("sha256", _secret).update(`${userId}:${slot}`).digest("hex");
}

export function verifyCheckoutToken(userId: number, token: string): boolean {
  const slot = Math.floor(Date.now() / 3_600_000);
  for (const s of [slot, slot - 1]) {
    const expected = createHmac("sha256", _secret).update(`${userId}:${s}`).digest("hex");
    if (expected === token) return true;
  }
  return false;
}
