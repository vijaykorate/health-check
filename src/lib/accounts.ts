// Auth foundation for the standalone Health Check UI.
//
// Identity comes from the real Pockit backend (src/lib/pockit.ts): the
// technician signs in with their Pockit OTP and we mint a stateless,
// HMAC-signed httpOnly session cookie carrying their Pockit JWT (`pk`). Every
// server-side call to the Pockit Health Check APIs (src/lib/pockit-hc.ts) is
// authenticated with that JWT — this app never issues its own OTP, consent, or
// pairing codes (the backend owns all of that).

import { createHmac, timingSafeEqual } from "node:crypto";

export type Role = "technician" | "admin";

export interface User {
  id: string;
  name: string;
  mobile: string;
  role: Role;
  territories: string[];
}

export interface Order {
  orderId: string;
  customerName: string;
  customerMobile: string;
  deviceType: string;
  manufacturer: string;
  model: string;
  serviceType: string;
  assignedTechnicianId: string;
  territory: string;
  status: "open" | "closed";
}

// ── Auth session (httpOnly cookie -> stateless signed token) ────────────────

export interface AuthSession {
  token: string;
  userId: string;
  role: Role;
  /** Display name for the signed-in technician. */
  name?: string;
  /** Pockit backend JWT — lets server routes call the Pockit backend as this
   *  technician. httpOnly cookie only, never exposed to browser JS. */
  pk?: string;
  createdAt: number;
  expiresAt: number;
}

const SHIFT_TTL_MS = 8 * 60 * 60 * 1000; // a shift

// Stateless, signed session cookie: the token carries the payload plus an HMAC
// signature, so any instance verifies it without shared storage. Set
// AUTH_SECRET in the environment; the dev fallback is intentionally insecure.
const AUTH_SECRET =
  process.env.AUTH_SECRET ??
  process.env.NEXTAUTH_SECRET ??
  "dev-insecure-secret-change-me";

interface SessionPayload {
  userId: string;
  role: Role;
  name?: string;
  pk?: string;
  createdAt: number;
  expiresAt: number;
}

function sign(data: string): string {
  return createHmac("sha256", AUTH_SECRET).update(data).digest("base64url");
}

/** Mint a short-lived, self-contained token; the value goes in an httpOnly
 *  cookie (never a URL). Requires no server-side storage. */
export function createAuthSession(
  userId: string,
  role: Role,
  name?: string,
  pockitToken?: string,
): AuthSession {
  const now = Date.now();
  const payload: SessionPayload = {
    userId,
    role,
    ...(name ? { name } : {}),
    ...(pockitToken ? { pk: pockitToken } : {}),
    createdAt: now,
    expiresAt: now + SHIFT_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${encoded}.${sign(encoded)}`;
  return { token, ...payload };
}

export function getAuthSession(token: string | undefined): AuthSession | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = sign(encoded);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (Date.now() > payload.expiresAt) return null;
  return { token, ...payload };
}

export function endAuthSession(token: string | undefined): void {
  // Stateless sessions carry no server-side state; clearing the cookie (done
  // by the logout route) is a complete sign-out.
  void token;
}

export const AUTH_COOKIE = "hc_session";
