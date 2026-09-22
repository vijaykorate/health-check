// POST /api/auth/request-otp — technician shift login, OTP #1 (identity).
// Sends the OTP through the REAL Pockit backend (app/technician/sendOTP), so
// only registered Pockit technicians can sign in — no dummy accounts.
import { NextResponse } from "next/server";
import { sendTechnicianOtp } from "@/lib/pockit";

export async function POST(request: Request) {
  let body: { mobile?: string; countryCode?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }
  const mobile = (body.mobile ?? "").toString().trim();
  if (!mobile) {
    return NextResponse.json({ error: "Mobile number is required" }, { status: 400 });
  }
  const countryCode = (body.countryCode ?? "").toString().trim() || undefined;

  const result = await sendTechnicianOtp(mobile, countryCode);
  if (!result.ok) {
    return NextResponse.json({ error: result.message ?? "Could not send OTP" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, sent: true });
}
