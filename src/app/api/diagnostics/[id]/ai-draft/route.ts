import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend } from "@/lib/pockit-hc";
import { loadBackendDetail } from "@/lib/hc-detail";
import { draftDiagnosis, searchKnowledgeBase, isConfigured } from "@/lib/hc-ai";
import type { DiagnosticReport } from "@/lib/types";

interface BackendDraft {
  available?: boolean;
  similarCases?: unknown[];
}

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const detailPromise = loadBackendDetail(id, me.pockitToken);
  const similarPromise = hcBackend<BackendDraft>(
    `api/diagnostics/${encodeURIComponent(id)}/draft-suggestion`,
    { method: "POST", token: me.pockitToken },
  );

  const detailR = await detailPromise;
  if (!detailR.ok) {
    return NextResponse.json(
      { error: detailR.message ?? "Session not found." },
      { status: detailR.status >= 400 ? detailR.status : 404 },
    );
  }

  const d = detailR.data;
  const diagnostic =
    d.diagnostic && Object.keys(d.diagnostic).length > 0
      ? (d.diagnostic as DiagnosticReport)
      : null;
  const manufacturer = diagnostic?.Machine?.Manufacturer ?? d.manufacturer ?? null;
  const model = diagnostic?.Machine?.Model ?? d.model ?? null;
  const rawCategory = diagnostic?.Complaint?.Category ?? null;
  const category = rawCategory && rawCategory !== "None" ? rawCategory : null;
  const problem = d.problem ?? diagnostic?.Complaint?.Description ?? null;
  const checks = diagnostic?.Checks ?? [];
  const inspection = d.inspection ?? {};

  const [draft, external, similarR] = await Promise.all([
    draftDiagnosis({ problem, checks, inspection }),
    searchKnowledgeBase({ manufacturer, model, category, problem }),
    similarPromise,
  ]);

  const similarCases = Array.isArray(similarR.data?.similarCases)
    ? similarR.data.similarCases
    : [];

  return NextResponse.json({
    finding: draft?.finding ?? null,
    diagnosis: draft?.diagnosis ?? null,
    recommendation: draft?.recommendation ?? null,
    similarCases,
    external,
    aiConfigured: isConfigured(),
  });
}
