// POST /api/diagnostics/[id]/request-consent — technician sends the consent
// request to the customer. BFF proxy to the existing Pockit backend
// `POST /api/diagnostics/:id/request-consent` (healthCheck.requestConsent),
// which sets CONSENT_STATUS='PENDING' and notifies the customer's Pockit app so
// they Approve/Decline/Later. The technician never approves consent — only
// raises the request. The scan stays backend-gated on CONSENT_STATUS='APPROVED'.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend } from "@/lib/pockit-hc";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const r = await hcBackend(
    `api/diagnostics/${encodeURIComponent(id)}/request-consent`,
    { method: "POST", token: me.pockitToken, body: {} },
  );
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Could not send the consent request." },
      { status: r.status >= 400 ? r.status : 500 },
    );
  }
  return NextResponse.json({ ok: true, message: r.message ?? "Consent request sent." });
}
