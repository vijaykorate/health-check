// Short-lived, order-scoped token for the CUSTOMER Health Check consent bridge.
//
// The customer approves/declines the Health Check in their own Pockit app
// (Customer-App src/api/services/healthCheckService.ts). That app has no HC-Web
// session cookie, so we hand it a signed `t` when it launches the HC
// (`POST /api/hc/customer-launch`) and verify `t` when it posts a decision
// (`POST /api/hc/consent`). The token carries the app's {orderId, customerId}
// claim; the backend still re-checks ownership (order_master.CUSTOMER_ID) before
// recording consent, so a forged/replayed token cannot approve someone else's HC.
import crypto from "node:crypto";

const SECRET = process.env.AUTH_SECRET ?? "local-dev-hc-session-secret-change-me";
const TTL_MS = 30 * 60 * 1000; // 30 minutes — long enough to read + decide.

export function signOrderToken(orderId: string, customerId: string): string {
  const payload = {
    orderId: String(orderId),
    customerId: String(customerId),
    exp: Date.now() + TTL_MS,
  };
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
  return `${b}.${sig}`;
}

export function verifyOrderToken(
  token: string,
): { orderId: string; customerId: string } | null {
  if (!token || !token.includes(".")) return null;
  const [b, sig] = token.split(".");
  const expect = crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
  // Constant-time compare to avoid leaking the signature byte-by-byte.
  const a = Buffer.from(sig);
  const e = Buffer.from(expect);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
  try {
    const p = JSON.parse(Buffer.from(b, "base64url").toString("utf8"));
    if (!p.exp || Date.now() > p.exp) return null;
    return { orderId: String(p.orderId), customerId: String(p.customerId) };
  } catch {
    return null;
  }
}
