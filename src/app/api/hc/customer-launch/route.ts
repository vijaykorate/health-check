// POST /api/hc/customer-launch  { orderId, customerId }  ->  { url }
//
// The Customer App calls this (healthCheckService.getHealthCheckLaunchUrl) to open
// the Health Check in a WebView. We confirm an HC exists for the order, mint a
// short-lived order-scoped token `t` carrying the app's {orderId, customerId}, and
// return a WebView URL with `t` embedded. The app later extracts `t` from that URL
// and posts it back to /api/hc/consent. Real ownership is enforced by the backend
// when consent is recorded (order_master.CUSTOMER_ID), not here.
import { NextResponse } from "next/server";
import { hcBackend } from "@/lib/pockit-hc";
import { signOrderToken } from "@/lib/customer-token";

export async function POST(request: Request) {
  let body: { orderId?: string; customerId?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body → validation below */
  }
  const orderId = String(body.orderId ?? "").trim();
  const customerId = String(body.customerId ?? "").trim();
  if (!orderId || !customerId) {
    return NextResponse.json(
      { error: "orderId and customerId are required" },
      { status: 400 },
    );
  }

  const r = await hcBackend<{ sessionId?: string }>(
    `v1/orders/${encodeURIComponent(orderId)}/health-check/public`,
    {},
  );
  if (!r.ok) {
    const status = r.status === 404 || r.httpStatus === 404 ? 404 : r.status >= 400 ? r.status : 404;
    return NextResponse.json(
      { error: r.message ?? "No health check has been started for this order yet." },
      { status },
    );
  }

  const token = signOrderToken(orderId, customerId);
  const base = (process.env.APP_BASE_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
  const sessionId = r.data.sessionId ?? "";
  const url = `${base}/check/${encodeURIComponent(sessionId)}?customer=1&t=${encodeURIComponent(token)}`;
  return NextResponse.json({ url });
}
