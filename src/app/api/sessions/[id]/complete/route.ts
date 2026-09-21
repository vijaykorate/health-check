// POST /api/sessions/[id]/complete — final report from the engine.
import { NextResponse } from "next/server";
import { completeSession } from "@/lib/store";
import type { DiagnosticReport } from "@/lib/types";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let report: DiagnosticReport;
  try {
    report = (await request.json()) as DiagnosticReport;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Sanity-gate: the body must look like a diagnostic report.
  if (!report || typeof report !== "object" || !("SchemaVersion" in report)) {
    return NextResponse.json(
      { error: "Body is not a diagnostic report (missing SchemaVersion)" },
      { status: 400 },
    );
  }

  const result = completeSession(id, report);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
