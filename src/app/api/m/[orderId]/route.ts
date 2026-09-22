// GET /api/m/[orderId] — data for the customer's mobile surface.
// Public (the customer's own phone, no technician session). Returns ONLY the
// consent OTP and, once the scan completes, the final report — nothing else.
//
// SIMULATION: a real build pushes the OTP to the authenticated customer app and
// this endpoint would be gated to that customer; here it's keyed by orderId.
import { NextResponse } from "next/server";
import { peekOtp } from "@/lib/accounts";
import { findLatestByOrder, toView } from "@/lib/store";
import { readConsent, readConsentDecision, readReport } from "@/lib/shared-order";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await ctx.params;

  // Order metadata comes from the technician-created session (the source of
  // truth for a real Pockit order).
  const session = await findLatestByOrder(orderId);
  if (!session) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const customerName = session.customerName ?? null;
  const device = [session.manufacturer, session.model].filter(Boolean).join(" ") || null;

  // Prefer the shared store (works cross-instance on Vercel); fall back to the
  // in-memory state so local single-process dev behaves exactly as before.
  const localDelivered = session?.delivered === true && !!session?.diagnostic;

  const consentCode =
    (await readConsent(orderId)) ?? peekOtp("consent", orderId)?.code ?? null;
  const decision = await readConsentDecision(orderId);
  const report =
    (await readReport(orderId)) ?? (localDelivered ? toView(session!).diagnostic : null);

  return NextResponse.json({
    orderId,
    customerName,
    device,
    // Consent sync (Phase 2): technician requested → customer decides → both read here.
    consentRequested: consentCode !== null,
    consentCode,
    consentDecision: decision?.decision ?? null,
    report,
    status: report ? "scanned" : session?.status ?? null,
  });
}
