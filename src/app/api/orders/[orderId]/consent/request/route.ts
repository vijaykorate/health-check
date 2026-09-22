// POST /api/orders/[orderId]/consent/request — issue OTP #2 (customer consent).
// In production this pushes to the customer's mobile app; here it lands on the
// mock customer surface (/m/[orderId]).
import { NextResponse } from "next/server";
import { issueOtp, DUMMY_OTP } from "@/lib/accounts";
import { currentUser } from "@/lib/session-auth";
import { findLatestByOrder } from "@/lib/store";
import { publishConsent } from "@/lib/shared-order";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { orderId } = await ctx.params;
  // The technician must own the session they're requesting consent for.
  const session = await findLatestByOrder(orderId);
  if (!session || session.technicianId !== me.user.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  // Consent is delivered to the customer (channel = orderId); the customer
  // approves in their app. Fixed code backs the read-aloud fallback.
  issueOtp("consent", orderId, DUMMY_OTP);
  // Mirror to the shared store so the customer's phone — which may hit a
  // different serverless instance — sees the consent prompt.
  await publishConsent(orderId, DUMMY_OTP);
  return NextResponse.json({ ok: true, sentTo: session.customerMobile ?? null });
}
