// GET /api/m/[orderId] — data for the customer's mobile surface.
// Public (the customer's own phone, no technician session). Returns ONLY the
// consent OTP and, once the scan completes, the final report — nothing else.
//
// SIMULATION: a real build pushes the OTP to the authenticated customer app and
// this endpoint would be gated to that customer; here it's keyed by orderId.
import { NextResponse } from "next/server";
import { getOrder, peekOtp } from "@/lib/accounts";
import { findLatestByOrder, toView } from "@/lib/store";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await ctx.params;
  const order = getOrder(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const consent = peekOtp("consent", orderId);
  const session = findLatestByOrder(orderId);
  // The report reaches the customer only after the technician submits at Review.
  const delivered = session?.delivered === true && !!session?.diagnostic;

  return NextResponse.json({
    orderId: order.orderId,
    customerName: order.customerName,
    device: `${order.manufacturer} ${order.model}`,
    consentCode: consent?.code ?? null,
    report: delivered ? toView(session!).diagnostic : null,
    status: session?.status ?? null,
  });
}
