// POST /api/diagnostics/[id]/deliver — technician submits at Review; the report
// is released to the customer's mobile app (+ email/WhatsApp stubs).
import { NextResponse } from "next/server";
import { getSession, markDelivered } from "@/lib/store";
import { publishReport } from "@/lib/shared-order";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const result = await markDelivered(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  // Release the report to the shared store so the customer's phone (a separate
  // device / serverless instance) can read it.
  const session = await getSession(id);
  if (session?.orderId && session.diagnostic) {
    await publishReport(session.orderId, session.diagnostic);
  }
  // Integration seam: fire SendGrid / WhatsApp delivery here.
  return NextResponse.json({ ok: true });
}
