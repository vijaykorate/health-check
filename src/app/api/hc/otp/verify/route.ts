// POST /api/hc/otp/verify — verify the technician's Health Check shift OTP.
// BFF proxy to backend `POST /v1/technicians/:id/health-check-otp/verify`
// (healthCheck.verifyOtp). A verified shift is what lets the diagnostic
// script's callbacks pass the backend's requireValidShift gate.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend } from "@/lib/pockit-hc";

export async function POST(request: Request) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { otp?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* empty ok */
  }
  const otp = (body.otp ?? "").toString().trim();
  if (!otp) return NextResponse.json({ error: "otp is required" }, { status: 400 });

  const r = await hcBackend(
    `v1/technicians/${encodeURIComponent(me.user.id)}/health-check-otp/verify`,
    { method: "POST", token: me.pockitToken, body: { otp } },
  );
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Invalid or expired OTP." },
      { status: r.status >= 400 ? r.status : 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
