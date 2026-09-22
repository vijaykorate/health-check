// POST /api/diagnostics/[id]/deliver — BFF proxy to backend
// `POST /api/diagnostics/:id/submit` (wizard.postSubmit): generates the PDF,
// records completion, and fires the customer notifications. No local report
// generation or storage.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend } from "@/lib/pockit-hc";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const r = await hcBackend<{ ok?: boolean; pdfUrl?: string; diagnosticId?: string }>(
    `api/diagnostics/${encodeURIComponent(id)}/submit`,
    { method: "POST", token: me.pockitToken },
  );
  if (!r.ok) {
    // e.g. 409 "hasn't finished scanning yet" / "already submitted".
    return NextResponse.json(
      { error: r.message ?? "Could not submit." },
      { status: r.status >= 400 ? r.status : 409 },
    );
  }
  return NextResponse.json({
    ok: true,
    pdfUrl: r.data.pdfUrl ?? null,
    diagnosticId: r.data.diagnosticId ?? null,
  });
}
