// GET /api/diagnostics/[id]/report?u=<backend pdf url> — download the delivered
// Health Check report PDF with the human-facing order number as the filename
// ("ORD_YYYYMMDD_NNNNN_pockitengineers.pdf"). The PDF is served by the backend;
// we proxy it so we can set Content-Disposition. The exact backend PDF path comes
// from the deliver response (deliverResult.pdfUrl), passed as `u` — we validate it
// points at the backend's reports/ area (no open proxy) before fetching.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { backendUrl } from "@/lib/pockit-hc";
import { reportFilename } from "@/lib/orders";
import { resolveOrderNo, proxyReportPdf } from "@/lib/report-download";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  // Only ever proxy the backend's own report PDFs — never an arbitrary URL.
  const src = new URL(request.url).searchParams.get("u") ?? "";
  const allowedPrefix = backendUrl("reports/");
  const target = src || backendUrl(`reports/${encodeURIComponent(id)}.pdf`);
  if (!target.startsWith(allowedPrefix)) {
    return NextResponse.json({ error: "invalid report url" }, { status: 400 });
  }

  const orderNo = await resolveOrderNo(id, me.pockitToken, me.user.id);
  return proxyReportPdf(target, reportFilename(orderNo, id));
}
