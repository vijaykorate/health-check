// POST /api/diagnostics/[id]/findings — save technician findings.
import { NextResponse } from "next/server";
import { setFindings } from "@/lib/store";
import type { Severity } from "@/lib/types";

const SEVERITIES = new Set<Severity>(["Low", "Medium", "High", "Critical"]);

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: {
    primaryFinding?: string;
    severity?: string;
    diagnosis?: string;
    recommendation?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const severity =
    body.severity && SEVERITIES.has(body.severity as Severity)
      ? (body.severity as Severity)
      : null;

  const result = setFindings(id, {
    primaryFinding: body.primaryFinding?.trim() || null,
    severity,
    diagnosis: body.diagnosis?.trim() || null,
    recommendation: body.recommendation?.trim() || null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
