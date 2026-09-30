// POST /api/diagnostics/[id]/regenerate-report — BFF proxy to backend
// `POST /api/diagnostics/:id/regenerate-report` (wizard.regenerateReport): rebuilds
// the PDF for a completed Health Check so it includes the optional Rescan Result.
// Does not change the original completed result.
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
  const r = await hcBackend<{ pdfUrl?: string }>(
    `api/diagnostics/${encodeURIComponent(id)}/regenerate-report`,
    { method: "POST", token: me.pockitToken },
  );
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Could not regenerate the report." },
      { status: r.status >= 400 ? r.status : 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    pdfUrl: r.data.pdfUrl ? backendUrl(r.data.pdfUrl) : null,
  });
}
