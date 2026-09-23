// POST /api/hc/consent  { orderId, decision: 'accepted' | 'declined', t }
//
// The customer taps Approve/Decline in their Pockit app
// (Customer-App healthCheckService.submitHealthCheckConsent). `t` is the token we
// minted in /api/hc/customer-launch. We verify it, then forward the decision to the
// backend, which re-checks that the token's customerId actually owns the order
// (order_master.CUSTOMER_ID) before flipping CONSENT_STATUS. Approving here is what
// unlocks the technician's scan.
import { NextResponse } from "next/server";
import { hcBackend } from "@/lib/pockit-hc";
import { verifyOrderToken } from "@/lib/customer-token";

export async function POST(request: Request) {
  let body: { orderId?: string; decision?: string; t?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body → validation below */
  }
  const orderId = String(body.orderId ?? "").trim();
  const decision = String(body.decision ?? "").toLowerCase();
  const t = String(body.t ?? "");
  if (!orderId || (decision !== "accepted" && decision !== "declined")) {
    return NextResponse.json(
      { error: "orderId and decision ('accepted' | 'declined') are required" },
      { status: 400 },
    );
  }

  const claim = verifyOrderToken(t);
  if (!claim || claim.orderId !== orderId) {
    return NextResponse.json(
      { error: "This consent link is invalid or has expired. Please reopen the health check." },
      { status: 403 },
    );
  }

  const r = await hcBackend(
    `v1/orders/${encodeURIComponent(orderId)}/health-check/consent`,
    { method: "POST", body: { customerId: claim.customerId, decision } },
  );
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Could not record your response. Please try again." },
      { status: r.status >= 400 ? r.status : 500 },
    );
  }
  return NextResponse.json({ ok: true, decision });
}
