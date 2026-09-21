// POST /api/diagnostics/[id]/deliver — technician submits at Review; the report
// is released to the customer's mobile app (+ email/WhatsApp stubs).
import { NextResponse } from "next/server";
import { markDelivered } from "@/lib/store";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const result = markDelivered(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  // Integration seam: fire SendGrid / WhatsApp delivery here.
  return NextResponse.json({ ok: true });
}
