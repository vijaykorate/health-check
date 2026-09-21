// POST /api/orders/[orderId]/consent/verify — verify OTP #2, then start the
// scan bound to this order. Two gates cleared by now: technician identity
// (session cookie) + customer consent (this OTP).
import { NextResponse } from "next/server";
import { getOrder, verifyOtp, DUMMY_OTP } from "@/lib/accounts";
import { currentUser } from "@/lib/session-auth";
import { createSession } from "@/lib/store";

export async function POST(
  request: Request,
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

  let body: { code?: string; complaint?: string; stressTest?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }
  const code = (body.code ?? "").toString().trim();
  // DEMO: accept the fixed dummy code, or a real issued one.
  if (code !== DUMMY_OTP && !verifyOtp("consent", orderId, code)) {
    return NextResponse.json({ error: "Invalid or expired consent code" }, { status: 401 });
  }

  const complaint = (body.complaint ?? "").toString().trim();
  // Do NOT auto-spawn — the technician launches the scan on the machine being
  // serviced (paste command / download & run) from the wizard's Launch step.
  const session = createSession({
    complaint,
    category: "",
    stressTest: body.stressTest === true,
    orderId: order.orderId,
    technicianId: me.user.id,
    territory: order.territory,
    customerName: order.customerName,
    customerMobile: order.customerMobile,
  });

  return NextResponse.json({ id: session.id, url: `/check/${session.id}` }, { status: 201 });
}
