// POST /api/hc/consent — the customer accepts/declines the health-check consent
// from their app's WebView. Authorized by the short-lived order-scoped token
// minted by /api/hc/customer-launch (so only the launched customer can decide,
// for their own order). Records the decision in the shared KV — the single
// source of truth the technician's wizard polls. Consent logic is not
// duplicated in the mobile client.
import { NextResponse } from "next/server";
import { verifyOrderToken } from "@/lib/accounts";
import { findLatestByOrder } from "@/lib/store";
import { publishConsentDecision } from "@/lib/shared-order";

export async function POST(request: Request) {
  let body: { orderId?: string; decision?: string; t?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const orderId = (body.orderId ?? "").toString().trim();
  const decision = body.decision === "declined" ? "declined" : "accepted";

  // The token proves this customer was launched for this order.
  const claim = verifyOrderToken(body.t);
  if (!claim || claim.orderId !== orderId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // The session must still exist and be eligible (not cancelled).
  const session = await findLatestByOrder(orderId);
  if (!session) {
    return NextResponse.json({ error: "no_health_check" }, { status: 404 });
  }
  if (session.status === "failed") {
    return NextResponse.json({ error: "cancelled" }, { status: 409 });
  }
  // Ownership re-check against the token's customer id.
  if (session.customerId && session.customerId !== claim.customerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await publishConsentDecision(orderId, { decision, at: Date.now() });
  return NextResponse.json({ ok: true, decision });
}
