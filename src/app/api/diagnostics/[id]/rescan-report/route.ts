// GET /api/diagnostics/[id]/rescan-report — download the backend's SEPARATE
// rescan (post-scan) report PDF (/reports/:id/rescan.pdf). We proxy it through
// this app (rather than redirecting) so the download filename is the human-facing
// order number — "ORD_YYYYMMDD_NNNNN_pockitengineers.pdf" — instead of the
// backend's "rescan.pdf". The backend report route is pre-auth by unguessable
// filename; we still gate this entry point on a signed-in technician.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { backendUrl } from "@/lib/pockit-hc";
import { reportFilename } from "@/lib/orders";
import { resolveOrderNo, proxyReportPdf } from "@/lib/report-download";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const orderNo = await resolveOrderNo(id, me.pockitToken, me.user.id);
  return proxyReportPdf(
    backendUrl(`reports/${encodeURIComponent(id)}/rescan.pdf`),
    reportFilename(orderNo, id),
  );
}
