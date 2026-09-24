// GET /api/diagnostics/[id] — BFF proxy to the existing Pockit backend
// `GET /api/diagnostics/:id` (wizard.getDetail). Adapts the backend's
// snake_case detail payload into the SessionView the UI already renders.
// No local session store: the backend `health_checks` row + Mongo progress
// doc are the single source of truth.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { loadBackendDetail } from "@/lib/hc-detail";
import type { DiagnosticReport, Finding, SessionView } from "@/lib/types";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const r = await loadBackendDetail(id, me.pockitToken);
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Session not found." },
      { status: r.status >= 400 ? r.status : 404 },
    );
  }

  const d = r.data;
  let findings: Finding[] = [];
  try {
    findings = JSON.parse(d.findings_json || "[]") as Finding[];
  } catch {
    findings = [];
  }
  const diagnostic =
    d.diagnostic && Object.keys(d.diagnostic).length > 0
      ? (d.diagnostic as DiagnosticReport)
      : null;

  const view: SessionView = {
    id: d.id,
    status: d.status,
    percent: d.progress_percent ?? 0,
    stage: d.progress_stage ?? "connecting",
    message: d.progress_message ?? "",
    findings,
    overallStatus: d.overall_status ?? null,
    scanError: d.scan_error ?? null,
    diagnostic,
    healthScore: diagnostic?.Summary?.HealthScore ?? null,
    stressTest: false,
    technician: {
      primaryFinding: d.primary_finding ?? null,
      severity: (d.severity as SessionView["technician"]["severity"]) ?? null,
      diagnosis: d.diagnosis ?? null,
      recommendation: d.recommendation ?? null,
    },
    createdAt: new Date().toISOString(),
    stalled: !!d.stalled,
    inspection: d.inspection ?? {},
    observations: d.observations ?? null,
    delivered: d.status === "completed",
    // This standalone UI is always an on-site technician visit; a truthy
    // orderId keeps the visit chrome. We surface the backend ticket number.
    orderId: d.ticket_number ?? id,
    customerName: d.customer_name ?? null,
    diagnosticId: d.diagnostic_id ?? null,
    customerConnectionStatus: d.customerConnectionStatus ?? "NOT_CONNECTED",
    customerOnline: !!d.customerOnline,
    consentStatus: d.consentStatus ?? null,
    consentRejectReason: d.consentRejectReason ?? null,
  };
  return NextResponse.json(view);
}
