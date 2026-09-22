// Auth + consent primitives for the Health Check app.
//
// Technician identity and orders come from the real Pockit backend
// (src/lib/pockit.ts). This module holds the stateless session cookie, the
// order-scoped consent token, and the (demo) consent OTP channel.

import { createHmac, timingSafeEqual } from "node:crypto";

export type Role = "technician" | "admin";

export interface User {
  id: string;
  name: string;
  mobile: string;
  role: Role;
  /** Territories an admin can see; technicians serve their own orders. */
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

// Identity + orders now come from the real Pockit backend (see src/lib/pockit.ts):
// technicians authenticate via OTP and their jobs are fetched live. No seed
// users/orders here.

/** Fixed consent code for the customer-consent channel. The customer approves in
 *  their own app; this also backs the read-aloud fallback. Not a login credential. */
export const DUMMY_OTP = "123456";

// ── OTP store (stand-in for push/SMS delivery) ──────────────────────────────

export type OtpPurpose = "shift-login" | "consent";

interface OtpEntry {
  code: string;
  purpose: OtpPurpose;
  /** Where it was "delivered": a mobile number (login) or orderId (consent). */
  channel: string;
  createdAt: number;
  expiresAt: number;
}

// ── Auth session store (httpOnly cookie -> server session) ──────────────────

export interface AuthSession {
  token: string;
  userId: string;
  role: Role;
  /** Display name — carried for real (non-seed) technicians from Pockit. */
  name?: string;
  /** Pockit backend token — lets server routes call Pockit as this technician
   *  (e.g. fetch their real jobs). httpOnly cookie only, never exposed to JS. */
  pk?: string;
  createdAt: number;
  expiresAt: number;
}

// NOTE: OTPs are still kept in an in-memory Map. That's fine for the demo login
// (which uses the fixed DUMMY_OTP and never reads this Map), but the *consent*
// flow issues real random codes and will hit the same cross-instance problem on
// serverless — move that store to Vercel KV / Redis before relying on it in prod.
const g = globalThis as unknown as {
  __hcOtps?: Map<string, OtpEntry>;
};

const otps: Map<string, OtpEntry> = g.__hcOtps ?? (g.__hcOtps = new Map());

const OTP_TTL_MS = 10 * 60 * 1000;
const SHIFT_TTL_MS = 8 * 60 * 60 * 1000; // a shift

function sixDigits(): string {
  // Not crypto-strong; fine for a simulated OTP. Avoid Math.random per env rules.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

function otpKey(purpose: OtpPurpose, channel: string): string {
  return `${purpose}:${channel}`;
}

/**
 * Generate + "deliver" an OTP. In production this posts to Pockit push (login)
 * or the customer's mobile app (consent). Here it's stored and surfaced via
 * the mock device inbox.
 */
export function issueOtp(
  purpose: OtpPurpose,
  channel: string,
  fixedCode?: string,
): OtpEntry {
  const now = Date.now();
  const entry: OtpEntry = {
    code: fixedCode ?? sixDigits(),
    purpose,
    channel,
    createdAt: now,
    expiresAt: now + OTP_TTL_MS,
  };
  otps.set(otpKey(purpose, channel), entry);
  return entry;
}

export function peekOtp(purpose: OtpPurpose, channel: string): OtpEntry | undefined {
  const e = otps.get(otpKey(purpose, channel));
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) {
    otps.delete(otpKey(purpose, channel));
    return undefined;
  }
  return e;
}

export function verifyOtp(purpose: OtpPurpose, channel: string, code: string): boolean {
  const e = peekOtp(purpose, channel);
  if (!e) return false;
  if (e.code !== code.trim()) return false;
  otps.delete(otpKey(purpose, channel)); // single-use
  return true;
}

// ── Auth sessions ───────────────────────────────────────────────────────────

// Stateless, signed session cookie: the token carries the session payload plus
// an HMAC signature, so any serverless instance can verify it without a shared
// store. Set AUTH_SECRET in the environment (Vercel Project Settings) — the dev
// fallback is intentionally insecure and must not be relied on in production.
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

  // Constant-time signature check (reject tampered/forged tokens).
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
  // Stateless sessions carry no server-side state; clearing the cookie
  // (done by the logout route) is a complete sign-out. The token is accepted
  // for API compatibility with the previous stateful implementation.
  void token;
}

export const AUTH_COOKIE = "hc_session";

// ── Order-scoped launch token (customer consent) ────────────────────────────
// A short-lived signed token binding a customer to an order. It authorizes the
// customer's in-app consent action (from the Customer App WebView) without any
// login — it is NOT a technician session and grants no wizard access. Reuses
// the same HMAC as the auth cookie.
interface OrderTokenPayload {
  orderId: string;
  customerId: string;
  purpose: "customer-consent";
  expiresAt: number;
}

export function mintOrderToken(
  orderId: string,
  customerId: string,
  ttlMs: number,
): string {
  const payload: OrderTokenPayload = {
    orderId,
    customerId,
    purpose: "customer-consent",
    expiresAt: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyOrderToken(token: string | undefined): OrderTokenPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: OrderTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.purpose !== "customer-consent") return null;
  if (Date.now() > payload.expiresAt) return null;
  return payload;
}
