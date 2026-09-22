// Session store: in-memory working set, warmed from and flushed to disk.
//
// Live progress ticks are kept in memory only; meaningful transitions (create,
// complete, fail, findings, cancel) are persisted so history survives restarts
// and can be mined by the AI own-data retrieval (feature 6).

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
import { loadAll, persist } from "./persistence";

/** A running scan should reach its next state within minutes; past this it's
 *  stalled (normal ~1–3 min, +60s AC test, +~2min stability test). */
export const STALE_RUNNING_MS = 20 * 60 * 1000;

const SERIAL_PLACEHOLDERS = new Set([
  "to be filled by o.e.m.",
  "system serial number",
  "default string",
  "none",
  "n/a",
  "",
]);

// Survive dev-server hot reloads by stashing state on globalThis.
const globalForStore = globalThis as unknown as {
  __healthCheckSessions?: Map<string, SessionRecord>;
};

function initSessions(): Map<string, SessionRecord> {
  const map = new Map<string, SessionRecord>();
  for (const rec of loadAll()) map.set(rec.id, rec);
  return map;
}

const sessions: Map<string, SessionRecord> =
  globalForStore.__healthCheckSessions ??
  (globalForStore.__healthCheckSessions = initSessions());

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

export function createSession(opts: CreateSessionOpts): SessionRecord {
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
  sessions.set(id, record);
  persist(record);
  return record;
}

export function getSession(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

export function updateProgress(id: string, payload: ProgressPayload): StoreResult {
  const record = sessions.get(id);
  if (!record) return { ok: false, reason: "not_found" };
  if (isTerminal(record)) return { ok: false, reason: "conflict" };

  record.percent = payload.Percent ?? record.percent;
  record.stage = payload.Stage ?? record.stage;
  record.message = payload.Message ?? record.message;
  record.findings = Array.isArray(payload.Findings) ? payload.Findings : record.findings;
  // Intentionally not persisted every tick — kept in memory.
  return { ok: true };
}

export function completeSession(id: string, report: DiagnosticReport): StoreResult {
  const record = sessions.get(id);
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
  persist(record);
  return { ok: true };
}

export function failSession(id: string, error: string): StoreResult {
  const record = sessions.get(id);
  if (!record) return { ok: false, reason: "not_found" };
  if (isTerminal(record)) return { ok: false, reason: "conflict" };

  record.status = "failed";
  record.scanError = error;
  record.completedAt = new Date().toISOString();
  persist(record);
  return { ok: true };
}

/** Cancel a running scan (feature 5). Only valid while still running. */
export function cancelSession(id: string): StoreResult {
  const record = sessions.get(id);
  if (!record) return { ok: false, reason: "not_found" };
  if (record.status !== "running") return { ok: false, reason: "conflict" };

  record.status = "failed";
  record.scanError = "Cancelled by technician";
  record.completedAt = new Date().toISOString();
  persist(record);
  return { ok: true };
}

/** Save the physical inspection checklist + observations. */
export function setInspection(
  id: string,
  inspection: import("./types").Inspection,
  observations: string | null,
): StoreResult {
  const record = sessions.get(id);
  if (!record) return { ok: false, reason: "not_found" };
  record.inspection = inspection ?? {};
  record.observations = observations ?? null;
  persist(record);
  return { ok: true };
}

/** Mark the case delivered (technician submitted at Review) — the customer
 *  report is gated on this. */
export function markDelivered(id: string): StoreResult {
  const record = sessions.get(id);
  if (!record) return { ok: false, reason: "not_found" };
  record.delivered = true;
  persist(record);
  return { ok: true };
}

/** Save technician findings (feature 5/6). */
export function setFindings(id: string, findings: TechnicianFindings): StoreResult {
  const record = sessions.get(id);
  if (!record) return { ok: false, reason: "not_found" };
  record.technician = {
    primaryFinding: findings.primaryFinding ?? null,
    severity: findings.severity ?? null,
    diagnosis: findings.diagnosis ?? null,
    recommendation: findings.recommendation ?? null,
  };
  persist(record);
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
export function findLatestByOrder(orderId: string): SessionRecord | undefined {
  return [...sessions.values()]
    .filter((r) => r.orderId === orderId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** All sessions, newest first, for the dashboard/history list. */
export function listSummaries(): SessionSummary[] {
  return [...sessions.values()]
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
 * days reads as a possible recurrence.
 */
export function inferOutcome(record: SessionRecord, category: string | null): CaseOutcome {
  if (!record.serialNumber) return "unknown";
  const laterSameSerial = [...sessions.values()]
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
export function findSimilarCases(params: {
  manufacturer: string | null;
  model: string | null;
  category: string | null;
  excludeSessionId: string;
  limit?: number;
}): SimilarCase[] {
  const { manufacturer, model, category, excludeSessionId, limit = 3 } = params;
  if (!manufacturer && !model) return [];

  const mfr = manufacturer?.toLowerCase() ?? null;
  const mdl = model?.toLowerCase() ?? null;

  const candidates = [...sessions.values()]
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
      outcome: inferOutcome(row, rowCategory),
    });
  }
  return cases;
}
