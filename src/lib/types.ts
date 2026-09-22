// Types mirroring the diagnostic engine's output contract.
//
// The PowerShell engine (scripts/Pockit-PC-Diagnostic-V1.0.ps1) emits JSON via
// ConvertTo-Json, so every key is PascalCase — the interfaces below match that
// exactly. Do NOT rename these to camelCase; they are the wire format.

/** Per-check status vocabulary emitted by the engine. */
export type CheckStatus = "Good" | "Watch" | "Attention" | "Detected" | "Unknown";

/** Overall roll-up computed by the engine's Summary. */
export type OverallStatus =
  | "NO_IMMEDIATE_ISSUE_DETECTED"
  | "WATCH"
  | "NEEDS_ATTENTION"
  | "PARTIALLY_ASSESSED";

/** A single streamed finding line during the scan. */
export interface Finding {
  At: string;
  Stage: string;
  Text: string;
}

/** Body the engine POSTs to /api/sessions/[id]/progress (PascalCase). */
export interface ProgressPayload {
  Percent: number;
  Stage: string;
  Message: string;
  Findings: Finding[];
}

/** One entry in the final report's Checks[] array. */
export interface Check {
  Area: string;
  Status: CheckStatus;
  Confidence: number;
  Value: string;
  Details: string;
  CheckedAt: string;
}

export interface RamModule {
  Manufacturer?: string;
  CapacityGB?: number;
  SpeedMHz?: number;
  Slot?: string;
}

export interface Machine {
  Manufacturer?: string;
  Model?: string;
  ComputerName?: string;
  OS?: string;
  OSVersion?: string;
  Build?: string;
  Architecture?: string;
  RAM_GB?: number | null;
  RAMModules?: RamModule[];
  CPU?: string;
  BIOS?: string;
  SerialNumber?: string;
  FormFactor?: string;
  StorageModel?: string | null;
}

export interface ReportSummary {
  Checks: number;
  Attention: number;
  Watch: number;
  Unknown: number;
  OverallStatus: OverallStatus;
  CustomerProblemProvided: boolean;
  FunctionalTestsStillAvailable: string[];
  /** 0–100 health score, computed server-side when results land (feature 2). */
  HealthScore?: number | null;
}

/** Result of the opt-in extended stability test (feature 3). */
export interface StressTestResult {
  Requested: boolean;
  DurationSeconds: number;
  CpuCoresLoaded: number | null;
  CpuCompleted: boolean;
  DiskWriteVerifiedMB: number | null;
  DiskCompleted: boolean;
  DiskSkippedReason: string | null;
  Errors: string[];
  Finding: string;
  Confidence: number;
  Explanation: string;
  CustomerMeaning: string;
}

export interface Complaint {
  Provided: boolean;
  Description: string | null;
  Category: string;
}

/** The full SchemaVersion "1.0" document POSTed to /api/sessions/[id]/complete. */
export interface DiagnosticReport {
  SchemaVersion: string;
  GeneratedAt: string;
  CollectionMode: string;
  Machine: Machine;
  Complaint: Complaint;
  // AutomaticDiagnostics carries the raw evidence; kept loose for the MVP.
  AutomaticDiagnostics?: Record<string, unknown>;
  Checks: Check[];
  Summary: ReportSummary;
  DiagnosticErrors: string[];
}

/** Lifecycle status of a session in our store. */
export type SessionStatus = "running" | "scanned" | "completed" | "failed";

/** Technician-assigned severity (feature 4 colours these). */
export type Severity = "Low" | "Medium" | "High" | "Critical";

/** Technician-recorded findings after a scan (feature 5/6 build on these). */
export interface TechnicianFindings {
  primaryFinding: string | null;
  severity: Severity | null;
  diagnosis: string | null;
  recommendation: string | null;
}

/** Physical inspection result per item (keyed "Section|Label"). */
export type InspectionStatus = "ok" | "issue" | "na";
export type Inspection = Record<string, InspectionStatus>;

/**
 * Internal session record (camelCase — this is ours, not the engine's).
 * Persisted to disk (see store.ts / persistence) so history survives restarts
 * and can be mined by the AI own-data retrieval (feature 6).
 */
export interface SessionRecord {
  id: string;
  status: SessionStatus;
  complaint: string;
  category: string;
  percent: number;
  stage: string;
  message: string;
  findings: Finding[];
  overallStatus: OverallStatus | null;
  scanError: string | null;
  diagnostic: DiagnosticReport | null;
  createdAt: string;
  completedAt: string | null;
  /** Opt-in extended stability test requested at booking (feature 3). */
  stressTest: boolean;
  /** 0–100, computed on complete (feature 2). */
  healthScore: number | null;
  /** Extracted from the report's Machine on complete, for history matching. */
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  /** Technician findings (feature 5/6). */
  technician: TechnicianFindings;
  /** Physical inspection checklist + free-text observations. */
  inspection: Inspection;
  observations: string | null;
  /** True once the technician submits at Review — gates the customer report. */
  delivered: boolean;
  /** Case context — set when started through the technician/order flow. */
  orderId: string | null;
  technicianId: string | null;
  /** Pockit CUSTOMER_ID — used to verify customer↔order ownership on launch. */
  customerId: string | null;
  territory: string | null;
  customerName: string | null;
  customerMobile: string | null;
}

/** Shape returned to the browser by GET /api/diagnostics/[id]. */
export interface SessionView {
  id: string;
  status: SessionStatus;
  percent: number;
  stage: string;
  message: string;
  findings: Finding[];
  overallStatus: OverallStatus | null;
  scanError: string | null;
  diagnostic: DiagnosticReport | null;
  healthScore: number | null;
  stressTest: boolean;
  technician: TechnicianFindings;
  createdAt: string;
  /** True when a running scan has exceeded the stalled threshold (feature 5). */
  stalled: boolean;
  inspection: Inspection;
  observations: string | null;
  delivered: boolean;
  orderId: string | null;
  customerName: string | null;
}

/** Compact row for the dashboard/history list. */
export interface SessionSummary {
  id: string;
  status: SessionStatus;
  createdAt: string;
  completedAt: string | null;
  percent: number;
  overallStatus: OverallStatus | null;
  healthScore: number | null;
  manufacturer: string | null;
  model: string | null;
  complaint: string;
  category: string;
  stalled: boolean;
  orderId: string | null;
  technicianId: string | null;
  territory: string | null;
  customerName: string | null;
}

/** Inferred outcome of a prior visit (feature 6 own-data retrieval). */
export type CaseOutcome = "possible_recurrence" | "no_repeat_visit" | "unknown";

/** A similar prior case surfaced from local history (feature 6). */
export interface SimilarCase {
  id: string;
  date: string;
  complaint: string;
  category: string | null;
  severity: Severity | null;
  diagnosis: string | null;
  recommendation: string | null;
  healthScore: number | null;
  outcome: CaseOutcome;
}

/** An external, cited reference from grounded web search (feature 6). */
export interface ExternalReference {
  title: string;
  url: string;
}
