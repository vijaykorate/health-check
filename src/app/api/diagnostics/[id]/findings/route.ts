// POST /api/diagnostics/[id]/findings — BFF proxy to backend
// `POST /api/diagnostics/:id/findings` (wizard.postFindings).
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend } from "@/lib/pockit-hc";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: {
    primaryFinding?: string | null;
    severity?: string | null;
    diagnosis?: string | null;
    recommendation?: string | null;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body ok */
  }
  const r = await hcBackend(`api/diagnostics/${encodeURIComponent(id)}/findings`, {
    method: "POST",
    token: me.pockitToken,
    body: {
      primaryFinding: body.primaryFinding ?? null,
      severity: body.severity ?? null,
      diagnosis: body.diagnosis ?? null,
      recommendation: body.recommendation ?? null,
    },
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Failed to save findings." },
      { status: r.status >= 400 ? r.status : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
