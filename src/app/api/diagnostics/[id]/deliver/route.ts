// POST /api/diagnostics/[id]/deliver — BFF proxy to backend
// `POST /api/diagnostics/:id/submit` (wizard.postSubmit): generates the PDF,
// records completion, and fires the customer notifications. No local report
// generation or storage.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend, backendUrl } from "@/lib/pockit-hc";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const r = await hcBackend<{
    ok?: boolean;
    pdfUrl?: string;
    diagnosticId?: string;
    emailStatus?: string;
    whatsappStatus?: string;
  }>(`api/diagnostics/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    token: me.pockitToken,
  });
  if (!r.ok) {
    // e.g. 409 "hasn't finished scanning yet" / "already submitted",
    // or 403 "Health Check has not been approved by admin yet".
    return NextResponse.json(
      { error: r.message ?? "Could not submit." },
      { status: r.status >= 400 ? r.status : 409 },
    );
  }
  return NextResponse.json({
    ok: true,
    // Absolute backend URL so the browser can open/download the report (the PDF
    // is served by the backend at /reports/:id.pdf, not by this app).
    pdfUrl: r.data.pdfUrl ? backendUrl(r.data.pdfUrl) : null,
    diagnosticId: r.data.diagnosticId ?? null,
    // Real delivery outcome (SENT / SKIPPED_* / FAILED:*) so the UI can tell the
    // truth instead of always claiming "delivered to email/WhatsApp".
    emailStatus: r.data.emailStatus ?? null,
    whatsappStatus: r.data.whatsappStatus ?? null,
  });
}
