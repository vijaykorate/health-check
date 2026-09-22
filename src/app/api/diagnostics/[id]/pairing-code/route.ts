// POST /api/diagnostics/[id]/pairing-code — BFF proxy to backend
// `POST /api/diagnostics/:id/pairing-code` (wizard.postPairingCode →
// healthCheck.generatePairingCode). Returns the plaintext 6-digit code once
// for the technician to read to the customer. This IS the consent request —
// the backend pairing model is the single consent/pairing system.
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
  const r = await hcBackend<{ code?: string; expiresAt?: string }>(
    `api/diagnostics/${encodeURIComponent(id)}/pairing-code`,
    { method: "POST", token: me.pockitToken },
  );
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Could not generate a connection code." },
      { status: r.status >= 400 ? r.status : 500 },
    );
  }
  return NextResponse.json({ code: r.data.code ?? null, expiresAt: r.data.expiresAt ?? null });
}
