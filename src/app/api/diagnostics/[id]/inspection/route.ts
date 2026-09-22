// POST /api/diagnostics/[id]/inspection — BFF proxy to backend
// `POST /api/diagnostics/:id/physical-findings` (wizard.postPhysicalFindings).
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
  let body: { inspection?: unknown; observations?: string | null } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body ok */
  }
  const r = await hcBackend(`api/diagnostics/${encodeURIComponent(id)}/physical-findings`, {
    method: "POST",
    token: me.pockitToken,
    body: { inspection: body.inspection ?? {}, observations: body.observations ?? null },
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Failed to save physical findings." },
      { status: r.status >= 400 ? r.status : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
