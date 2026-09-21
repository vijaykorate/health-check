// Simulated Pockit backend for the standalone build.
//
// Stands in for systems this app doesn't own — user directory, order_master,
// OTP push/SMS, and auth sessions — behind small functions that a real
// integration would replace. Everything is in-memory + disk-persisted so the
// two-OTP flow runs end-to-end here.
//
// INTEGRATION SEAMS (replace for production):
//   - deliverOtp()  -> Pockit push (technician app) / customer mobile app
//   - listOrders()  -> order_master query by technician/territory
//   - users/orders  -> real identity + job-card sources

import fs from "node:fs";
import path from "node:path";

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

// ── Seed data (stand-in for the real directory + order_master) ──────────────

const USERS: User[] = [
  { id: "tech-1", name: "Ravi Kumar", mobile: "9000000001", role: "technician", territories: ["North"] },
  { id: "tech-2", name: "Anita Sharma", mobile: "9000000002", role: "technician", territories: ["South"] },
  { id: "admin-1", name: "Priya Nair", mobile: "9000000010", role: "admin", territories: ["North", "South"] },
];

const ORDERS: Order[] = [
  { orderId: "ORD-2026-1001", customerName: "Meera Joshi", customerMobile: "9811111101", deviceType: "Laptop", manufacturer: "HP", model: "Pavilion 14", serviceType: "On-site diagnostic", assignedTechnicianId: "tech-1", territory: "North", status: "open" },
  { orderId: "ORD-2026-1002", customerName: "Arjun Rao", customerMobile: "9811111102", deviceType: "Laptop", manufacturer: "Dell", model: "Inspiron 15", serviceType: "Battery complaint", assignedTechnicianId: "tech-1", territory: "North", status: "open" },
  { orderId: "ORD-2026-1003", customerName: "Sana Khan", customerMobile: "9811111103", deviceType: "Desktop", manufacturer: "Lenovo", model: "ThinkCentre", serviceType: "Won't boot", assignedTechnicianId: "tech-2", territory: "South", status: "open" },
];

/** Dummy demo login — any mobile works with this fixed code. */
export const DUMMY_OTP = "123456";

export function findUserByMobile(mobile: string): User | undefined {
  return USERS.find((u) => u.mobile === mobile.trim());
}

/** Resolve a login to a user: a seeded account if the number matches, else a
 *  default technician (so any number can sign in for the demo). */
export function resolveLoginUser(mobile: string): User {
  return findUserByMobile(mobile) ?? USERS[0];
}
export function getUser(id: string): User | undefined {
  return USERS.find((u) => u.id === id);
}
export function getOrder(orderId: string): Order | undefined {
  return ORDERS.find((o) => o.orderId === orderId);
}
/** Orders a technician can start (their own open orders). */
export function listOrders(technicianId: string): Order[] {
  return ORDERS.filter((o) => o.assignedTechnicianId === technicianId && o.status === "open");
}

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
  createdAt: number;
  expiresAt: number;
}

const DATA_DIR = path.join(process.cwd(), "data");
const SESS_FILE = path.join(DATA_DIR, "auth-sessions.json");

const g = globalThis as unknown as {
  __hcOtps?: Map<string, OtpEntry>;
  __hcAuth?: Map<string, AuthSession>;
};

const otps: Map<string, OtpEntry> = g.__hcOtps ?? (g.__hcOtps = new Map());

function loadSessions(): Map<string, AuthSession> {
  try {
    const raw = fs.readFileSync(SESS_FILE, "utf8");
    return new Map(Object.entries(JSON.parse(raw) as Record<string, AuthSession>));
  } catch {
    return new Map();
  }
}
const authSessions: Map<string, AuthSession> = g.__hcAuth ?? (g.__hcAuth = loadSessions());

function persistSessions(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SESS_FILE, JSON.stringify(Object.fromEntries(authSessions)), "utf8");
  } catch (err) {
    console.error("[accounts] persist sessions failed:", err);
  }
}

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

/** Short-lived token, stored server-side; the value goes in an httpOnly cookie
 *  (never a URL). */
export function createAuthSession(userId: string, role: Role): AuthSession {
  const token = crypto.randomUUID();
  const now = Date.now();
  const session: AuthSession = {
    token,
    userId,
    role,
    createdAt: now,
    expiresAt: now + SHIFT_TTL_MS,
  };
  authSessions.set(token, session);
  persistSessions();
  return session;
}

export function getAuthSession(token: string | undefined): AuthSession | null {
  if (!token) return null;
  const s = authSessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    authSessions.delete(token);
    persistSessions();
    return null;
  }
  return s;
}

export function endAuthSession(token: string | undefined): void {
  if (token && authSessions.delete(token)) persistSessions();
}

export const AUTH_COOKIE = "hc_session";
