// GET /api/m/[orderId] — PUBLIC order-keyed Health Check state for the Customer App.
//
// The customer's Pockit app (Customer-App healthCheckService.getHealthCheckStatus)
// polls this to know whether to show the Approve/Decline prompt and, later, the
// report. No auth cookie: the customer has no HC-Web session — the backend apiKey
// (injected server-side by hcBackend) is the only credential. Order-keyed, so it
// never exposes another order's data beyond the requested orderId.
import { NextResponse } from "next/server";
import { hcBackend } from "@/lib/pockit-hc";

interface PublicHc {
  consentRequested?: boolean;
  consentDecision?: "accepted" | "declined" | null;
  status?: string | null;
  report?: string | null;
}

// Live per-order state — must never be cached, or the customer's WebView can
// replay a stale "consent needed" body after they've already approved.
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await ctx.params;
  const r = await hcBackend<PublicHc>(
    `v1/orders/${encodeURIComponent(orderId)}/health-check/public`,
    {},
  );
  if (!r.ok) {
    // 404 = no HC started yet → the app shows "No health check has been started
    // for this order yet." Anything else surfaces the backend status.
    const status = r.status === 404 || r.httpStatus === 404 ? 404 : r.status >= 400 ? r.status : 404;
    return NextResponse.json(
      { error: r.message ?? "No health check has been started for this order yet." },
      { status, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    {
      consentRequested: r.data.consentRequested === true,
      consentDecision: r.data.consentDecision ?? null,
      status: r.data.status ?? null,
      report: r.data.report ?? null,
    },
    { headers: NO_STORE },
  );
}
