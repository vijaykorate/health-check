// POST /api/orders/[orderId]/consent/request — issue OTP #2 (customer consent).
// In production this pushes to the customer's mobile app; here it lands on the
// mock customer surface (/m/[orderId]).
import { NextResponse } from "next/server";
import { getOrder, issueOtp, DUMMY_OTP } from "@/lib/accounts";
import { currentUser } from "@/lib/session-auth";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { orderId } = await ctx.params;
  const order = getOrder(orderId);
  if (!order || order.assignedTechnicianId !== me.user.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  // Consent OTP is delivered to the customer (channel = orderId).
  // DEMO: fixed dummy code so it always shows/accepts 123456.
  issueOtp("consent", orderId, DUMMY_OTP);
  return NextResponse.json({ ok: true, sentTo: order.customerMobile });
}
