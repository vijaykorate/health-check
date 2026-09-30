import { hcBackend, type HcResult } from "./pockit-hc";
import type { DiagnosticReport } from "./types";

export interface BackendDetail {
  id: string;
  diagnostic_id: string | null;
  customer_name: string | null;
  ticket_number: string | null;
  problem: string | null;
  manufacturer: string | null;
  model: string | null;
  diagnostic: DiagnosticReport | Record<string, never> | null;
  inspection: Record<string, "ok" | "issue"> | null;
  remarks: Record<string, string> | null;
  // Optional Rescan (technician-only, after completion), stored in the
  // INSPECTION_JSON envelope — no schema change. Null/absent otherwise.
  rescan?: DiagnosticReport | null;
  rescanStatus?: "running" | "scanned" | string | null;
  rescanAt?: string | null;
  // Technician fixes/actions performed between the original scan and the rescan.
  fixes?: Array<{ action?: string; note?: string }> | null;
  observations: string | null;
  primary_finding: string | null;
  severity: string | null;
  diagnosis: string | null;
  recommendation: string | null;
  progress_percent: number;
  progress_stage: string | null;
  progress_message: string | null;
  findings_json: string;
  status: "running" | "scanned" | "completed" | "failed";
  stalled: boolean;
  overall_status: DiagnosticReport["Summary"]["OverallStatus"] | null;
  scan_error: string | null;
  customerConnectionStatus?: string | null;
  customerOnline?: boolean;
  consentStatus?: string | null;
  consentRejectReason?: string | null;
}

export function loadBackendDetail(
  id: string,
  token: string | undefined,
): Promise<HcResult<BackendDetail>> {
  return hcBackend<BackendDetail>(`api/diagnostics/${encodeURIComponent(id)}`, { token });
}
