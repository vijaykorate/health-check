// GET /api/customer/[sessionId]/progress — customer-side status/progress poll.
// BFF proxy to the backend PRE-AUTH
// `GET /health-check/customer/:sessionId/progress` (wizard.getCustomerProgressPoll),
// which also doubles as the customer's connection heartbeat. Only works once a
// pairing code has been claimed (backend gates on CUSTOMER_CONNECTION_STATUS).
import { NextResponse } from "next/server";
import { hcBackend } from "@/lib/pockit-hc";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  const r = await hcBackend(
    `health-check/customer/${encodeURIComponent(sessionId)}/progress`,
    { auth: false },
  );
  // The backend returns { expired: true, ... } (HTTP 200) when the pairing is
  // no longer valid — pass its body through so the UI can show the message.
  return NextResponse.json(r.data, { status: r.httpStatus >= 400 ? r.httpStatus : 200 });
}
