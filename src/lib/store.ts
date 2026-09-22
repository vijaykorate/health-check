// Session store — shared across serverless instances via the project KV.
//
// Every session read/write goes through the shared KV (Upstash / Vercel KV on
// deploy, in-memory fallback for local dev — see kv.ts), so the technician and
// the customer, which hit different Vercel serverless instances, see the SAME
// session. This replaces the previous in-memory Map + local-file persistence,
// which cannot be shared across serverless instances.
//
// Keys:
//   hc:session:<id>     → the JSON SessionRecord
//   hc:order:<orderId>  → the id of the latest session for that order
//   hc:sessions         → a set of all session ids (for history/own-data)

import type {
  CaseOutcome,
  DiagnosticReport,
  OverallStatus,
  ProgressPayload,
  Severity,
  SessionRecord,
  SessionSummary,
  SessionView,
  SimilarCase,
  TechnicianFindings,
} from "./types";
import { computeHealthScore } from "./score";
import { kvGet, kvSet, kvSAdd, kvSMembers } from "./kv";

/** A running scan should reach its next state within minutes; past this it's
 *  stalled (normal ~1–3 min, +60s AC test, +~2min stability test). */
export const STALE_RUNNING_MS = 20 * 60 * 1000;

/** Sessions are retained long enough for the own-data / similar-cases feature
 *  (which looks back ~90 days) while staying bounded in KV. Refreshed on write. */
const SESSION_TTL_SEC = 90 * 24 * 60 * 60;

const SERIAL_PLACEHOLDERS = new Set([
  "to be filled by o.e.m.",
  "system serial number",
  "default string",
  "none",
  "n/a",
  "",
]);

const sessionKey = (id: string) => `hc:session:${id}`;
const orderKey = (orderId: string) => `hc:order:${orderId}`;
const INDEX_KEY = "hc:sessions";

// ── KV persistence helpers ──────────────────────────────────────────────────
async function readSession(id: string): Promise<SessionRecord | null> {
  const raw = await kvGet(sessionKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

async function writeSession(record: SessionRecord): Promise<void> {
  await kvSet(sessionKey(record.id), JSON.stringify(record), SESSION_TTL_SEC);
}

async function loadAllRecords(): Promise<SessionRecord[]> {
  const ids = await kvSMembers(INDEX_KEY);
  if (ids.length === 0) return [];
  const recs = await Promise.all(ids.map(readSession));
  return recs.filter((r): r is SessionRecord => r !== null);
}

export type StoreResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "conflict" };

function isTerminal(record: SessionRecord): boolean {
  return record.status === "scanned" || record.status === "failed";
}

function normalizeSerial(serial: string | undefined | null): string | null {
  if (!serial) return null;
  const s = serial.trim();
  if (SERIAL_PLACEHOLDERS.has(s.toLowerCase())) return null;
  if (/^0+$/.test(s)) return null;
  return s;
}

export function isStalled(record: SessionRecord): boolean {
  return (
    record.status === "running" &&
    Date.now() - new Date(record.createdAt).getTime() > STALE_RUNNING_MS
  );
}

export interface CreateSessionOpts {
  complaint: string;
  category: string;
  stressTest: boolean;
  orderId?: string | null;
  technicianId?: string | null;
  customerId?: string | null;
  territory?: string | null;
  customerName?: string | null;
  customerMobile?: string | null;
}

export async function createSession(opts: CreateSessionOpts): Promise<SessionRecord> {
  const id = crypto.randomUUID();
  const record: SessionRecord = {
    id,
    status: "running",
    complaint: opts.complaint,
    category: opts.category,
    percent: 0,
    stage: "connecting",
    message: "Starting health check…",
    findings: [],
    overallStatus: null,
    scanError: null,
    diagnostic: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    stressTest: opts.stressTest,
    healthScore: null,
    manufacturer: null,
    model: null,
    serialNumber: null,
    technician: {
      primaryFinding: null,
      severity: null,
      diagnosis: null,
      recommendation: null,
    },
    inspection: {},
    observations: null,
    delivered: false,
    orderId: opts.orderId ?? null,
    technicianId: opts.technicianId ?? null,
    customerId: opts.customerId ?? null,
    territory: opts.territory ?? null,
    customerName: opts.customerName ?? null,
    customerMobile: opts.customerMobile ?? null,
  };
  await writeSession(record);
  // Index by order (latest-created wins → matches "latest by createdAt") and in
  // the global set so history/own-data retrieval can enumerate sessions.
  if (record.orderId) await kvSet(orderKey(record.orderId), id, SESSION_TTL_SEC);
  await kvSAdd(INDEX_KEY, id);
  return record;
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  return (await readSession(id)) ?? undefined;
}

export async function updateProgress(
  id: string,
  payload: ProgressPayload,
): Promise<StoreResult> {
  const record = await readSession(id);
  if (!record) return { ok: false, reason: "not_found" };
  if (isTerminal(record)) return { ok: false, reason: "conflict" };

  record.percent = payload.Percent ?? record.percent;
  record.stage = payload.Stage ?? record.stage;
  record.message = payload.Message ?? record.message;
  record.findings = Array.isArray(payload.Findings) ? payload.Findings : record.findings;
  // On serverless the poller and the engine hit different instances, so progress
  // must be persisted (not kept in memory) to be visible cross-instance.
  await writeSession(record);
  return { ok: true };
}

export async function completeSession(
  id: string,
  report: DiagnosticReport,
): Promise<StoreResult> {
  const record = await readSession(id);
  if (!record) return { ok: false, reason: "not_found" };
  if (isTerminal(record)) return { ok: false, reason: "conflict" };

  // Health score, computed once here so every consumer reads the same number.
  const score = computeHealthScore(report.Checks);
  if (report.Summary) report.Summary.HealthScore = score;

  record.diagnostic = report;
  record.healthScore = score;
  record.overallStatus =
    (report.Summary?.OverallStatus as OverallStatus) ?? "PARTIALLY_ASSESSED";
  record.manufacturer = report.Machine?.Manufacturer?.trim() || null;
  record.model = report.Machine?.Model?.trim() || null;
  record.serialNumber = normalizeSerial(report.Machine?.SerialNumber);
  if (report.Complaint?.Category && report.Complaint.Category !== "None") {
    record.category = report.Complaint.Category;
  }
  record.status = "scanned";
  record.percent = 100;
  record.completedAt = new Date().toISOString();
  record.message = "Health check complete.";
  await writeSession(record);
  return { ok: true };
}

export async function failSession(id: string, error: string): Promise<StoreResult> {
  const record = await readSession(id);
  if (!record) return { ok: false, reason: "not_found" };
  if (isTerminal(record)) return { ok: false, reason: "conflict" };

  record.status = "failed";
  record.scanError = error;
  record.completedAt = new Date().toISOString();
  await writeSession(record);
  return { ok: true };
}

/** Cancel a running scan (feature 5). Only valid while still running. */
export async function cancelSession(id: string): Promise<StoreResult> {
  const record = await readSession(id);
  if (!record) return { ok: false, reason: "not_found" };
  if (record.status !== "running") return { ok: false, reason: "conflict" };

  record.status = "failed";
  record.scanError = "Cancelled by technician";
  record.completedAt = new Date().toISOString();
  await writeSession(record);
  return { ok: true };
}

/** Save the physical inspection checklist + observations. */
export async function setInspection(
  id: string,
  inspection: import("./types").Inspection,
  observations: string | null,
): Promise<StoreResult> {
  const record = await readSession(id);
  if (!record) return { ok: false, reason: "not_found" };
  record.inspection = inspection ?? {};
  record.observations = observations ?? null;
  await writeSession(record);
  return { ok: true };
}

/** Mark the case delivered (technician submitted at Review) — the customer
 *  report is gated on this. */
export async function markDelivered(id: string): Promise<StoreResult> {
  const record = await readSession(id);
  if (!record) return { ok: false, reason: "not_found" };
  record.delivered = true;
  await writeSession(record);
  return { ok: true };
}

/** Save technician findings (feature 5/6). */
export async function setFindings(
  id: string,
  findings: TechnicianFindings,
): Promise<StoreResult> {
  const record = await readSession(id);
  if (!record) return { ok: false, reason: "not_found" };
  record.technician = {
    primaryFinding: findings.primaryFinding ?? null,
    severity: findings.severity ?? null,
    diagnosis: findings.diagnosis ?? null,
    recommendation: findings.recommendation ?? null,
  };
  await writeSession(record);
  return { ok: true };
}

export function toView(record: SessionRecord): SessionView {
  return {
    id: record.id,
    status: record.status,
    percent: record.percent,
    stage: record.stage,
    message: record.message,
    findings: record.findings,
    overallStatus: record.overallStatus,
    scanError: record.scanError,
    diagnostic: record.diagnostic,
    healthScore: record.healthScore,
    stressTest: record.stressTest,
    technician: record.technician,
    createdAt: record.createdAt,
    stalled: isStalled(record),
    inspection: record.inspection ?? {},
    observations: record.observations ?? null,
    delivered: record.delivered ?? false,
    orderId: record.orderId,
    customerName: record.customerName,
  };
}

export function toSummary(record: SessionRecord): SessionSummary {
  return {
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    percent: record.percent,
    overallStatus: record.overallStatus,
    healthScore: record.healthScore,
    manufacturer: record.manufacturer,
    model: record.model,
    complaint: record.complaint,
    category: record.category,
    stalled: isStalled(record),
    orderId: record.orderId,
    technicianId: record.technicianId,
    territory: record.territory,
    customerName: record.customerName,
  };
}

/** Latest session tied to an order (customer surface / admin case view). */
export async function findLatestByOrder(
  orderId: string,
): Promise<SessionRecord | undefined> {
  const id = await kvGet(orderKey(orderId));
  if (!id) return undefined;
  return (await readSession(id)) ?? undefined;
}

/** All sessions, newest first, for the dashboard/history list. */
export async function listSummaries(): Promise<SessionSummary[]> {
  const all = await loadAllRecords();
  return all
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toSummary);
}

// ── Feature 6: own-data retrieval over local history ──────────────────────

function reportCategory(record: SessionRecord): string | null {
  return record.diagnostic?.Complaint?.Category ?? record.category ?? null;
}

/**
 * Infer whether a prior visit likely resolved the issue: a later completed
 * visit on the same machine (serial), same complaint category, within ~90
 * days reads as a possible recurrence. `all` is the full record set (passed in
 * so we don't re-read KV per row).
 */
export function inferOutcome(
  record: SessionRecord,
  category: string | null,
  all: SessionRecord[],
): CaseOutcome {
  if (!record.serialNumber) return "unknown";
  const laterSameSerial = all
    .filter(
      (r) =>
        r.id !== record.id &&
        (r.status === "scanned" || r.status === "completed") &&
        r.serialNumber === record.serialNumber &&
        new Date(r.createdAt).getTime() > new Date(record.createdAt).getTime(),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const later of laterSameSerial) {
    const days =
      (new Date(later.createdAt).getTime() - new Date(record.createdAt).getTime()) /
      86_400_000;
    if (days > 90) continue;
    if (category && reportCategory(later) === category) return "possible_recurrence";
  }
  return "no_repeat_visit";
}

/**
 * Find up to `limit` similar prior cases (same manufacturer/model, matching
 * category, with a recorded technician diagnosis/recommendation), newest first.
 */
export async function findSimilarCases(params: {
  manufacturer: string | null;
  model: string | null;
  category: string | null;
  excludeSessionId: string;
  limit?: number;
}): Promise<SimilarCase[]> {
  const { manufacturer, model, category, excludeSessionId, limit = 3 } = params;
  if (!manufacturer && !model) return [];

  const mfr = manufacturer?.toLowerCase() ?? null;
  const mdl = model?.toLowerCase() ?? null;

  const all = await loadAllRecords();
  const candidates = all
    .filter(
      (r) =>
        r.id !== excludeSessionId &&
        (r.status === "scanned" || r.status === "completed") &&
        (mfr ? r.manufacturer?.toLowerCase() === mfr : true) &&
        (mdl ? r.model?.toLowerCase() === mdl : true),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200);

  const cases: SimilarCase[] = [];
  for (const row of candidates) {
    if (cases.length >= limit) break;
    if (!row.technician.diagnosis && !row.technician.recommendation) continue;
    const rowCategory = reportCategory(row);
    if (category && rowCategory && rowCategory !== category) continue;
    cases.push({
      id: row.id,
      date: row.createdAt,
      complaint: row.complaint,
      category: rowCategory,
      severity: (row.technician.severity as Severity) ?? null,
      diagnosis: row.technician.diagnosis,
      recommendation: row.technician.recommendation,
      healthScore: row.healthScore,
      outcome: inferOutcome(row, rowCategory, all),
    });
  }
  return cases;
}
