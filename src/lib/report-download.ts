// Server-side helpers for downloading Health Check report PDFs with an
// order-number-based filename. The PDFs are served BY THE BACKEND; to control the
// download filename we proxy the backend PDF through this app and set our own
// Content-Disposition (the backend decides its own filename otherwise).
import { NextResponse } from "next/server";
import { loadBackendDetail } from "./hc-detail";
import { fetchTechnicianJobs } from "./pockit";
import { extractOrderNo } from "./orders";

/** Resolve a session's human-facing order number ("ORD/YYYYMMDD/NNNNN"):
 *  prefer the backend detail payload, then fall back to matching the technician's
 *  job list by the internal order id. Returns null if neither has it. */
export async function resolveOrderNo(
  id: string,
  token: string | undefined,
  technicianId: string,
): Promise<string | null> {
  const r = await loadBackendDetail(id, token);
  if (!r.ok) return null;
  const fromDetail = extractOrderNo(r.data as unknown as Record<string, unknown>);
  if (fromDetail) return fromDetail;
  const ticket = r.data.ticket_number;
  if (ticket && token) {
    const jobs = await fetchTechnicianJobs(token, technicianId);
    return jobs?.find((j) => j.orderId === String(ticket))?.serviceOrderNo || null;
  }
  return null;
}

/** Stream a backend-hosted report PDF back to the browser as an attachment with
 *  the given filename. `absoluteUrl` must already be an absolute backend URL. */
export async function proxyReportPdf(
  absoluteUrl: string,
  filename: string,
): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(absoluteUrl, { cache: "no-store" });
  } catch {
    return NextResponse.json({ error: "Could not reach the report server." }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "Report is not available yet." },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    );
  }
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "application/pdf");
  const len = upstream.headers.get("Content-Length");
  if (len) headers.set("Content-Length", len);
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Cache-Control", "no-store");
  return new NextResponse(upstream.body, { status: 200, headers });
}
