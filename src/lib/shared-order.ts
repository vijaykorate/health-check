// Order-scoped shared state that must cross devices/serverless instances:
// the customer consent code and the delivered health report. These are the
// only two data points the customer's phone (/m/[orderId]) needs from what the
// technician did — everything else it shows comes from static order seed data.
//
// Backed by the shared KV (Upstash on Vercel, in-memory locally). Every call is
// guarded so a KV outage degrades to "not available yet" rather than a 500.

import type { DiagnosticReport } from "./types";
import { kvGet, kvSet } from "./kv";

const CONSENT_TTL_SEC = 600; // 10 min, mirrors OTP_TTL_MS in accounts.ts
const DECISION_TTL_SEC = 24 * 60 * 60; // a customer decision stays valid for the shift/day
const REPORT_TTL_SEC = 7 * 24 * 60 * 60; // keep a delivered report readable for a week

const consentKey = (orderId: string) => `consent:${orderId}`;
const decisionKey = (orderId: string) => `consent-decision:${orderId}`;
const reportKey = (orderId: string) => `report:${orderId}`;

export type ConsentDecision = "accepted" | "declined";

export interface ConsentDecisionRecord {
  decision: ConsentDecision;
  at: number; // epoch ms — stamped by the caller (Date.now() is unavailable in some contexts)
}

/** Technician requested consent — make the code visible to the customer phone. */
export async function publishConsent(orderId: string, code: string): Promise<void> {
  try {
    await kvSet(consentKey(orderId), code, CONSENT_TTL_SEC);
  } catch (err) {
    console.error("[shared-order] publishConsent failed:", err);
  }
}

export async function readConsent(orderId: string): Promise<string | null> {
  try {
    return await kvGet(consentKey(orderId));
  } catch (err) {
    console.error("[shared-order] readConsent failed:", err);
    return null;
  }
}

/** Customer accepted/declined in their app — the signal the technician waits on. */
export async function publishConsentDecision(
  orderId: string,
  record: ConsentDecisionRecord,
): Promise<void> {
  try {
    await kvSet(decisionKey(orderId), JSON.stringify(record), DECISION_TTL_SEC);
  } catch (err) {
    console.error("[shared-order] publishConsentDecision failed:", err);
  }
}

export async function readConsentDecision(
  orderId: string,
): Promise<ConsentDecisionRecord | null> {
  try {
    const raw = await kvGet(decisionKey(orderId));
    return raw ? (JSON.parse(raw) as ConsentDecisionRecord) : null;
  } catch (err) {
    console.error("[shared-order] readConsentDecision failed:", err);
    return null;
  }
}

/** Technician delivered — release the report to the customer phone. */
export async function publishReport(
  orderId: string,
  report: DiagnosticReport,
): Promise<void> {
  try {
    await kvSet(reportKey(orderId), JSON.stringify(report), REPORT_TTL_SEC);
  } catch (err) {
    console.error("[shared-order] publishReport failed:", err);
  }
}

export async function readReport(orderId: string): Promise<DiagnosticReport | null> {
  try {
    const raw = await kvGet(reportKey(orderId));
    return raw ? (JSON.parse(raw) as DiagnosticReport) : null;
  } catch (err) {
    console.error("[shared-order] readReport failed:", err);
    return null;
  }
}
