// GET /api/otp/inbox?purpose=&channel= — mock device inbox.
//
// SIMULATION ONLY. Stands in for the OTP actually arriving on the technician's
// Pockit app (shift-login) or the customer's mobile app (consent). A real build
// deletes this route — the code would never be readable from the backend.
import { NextResponse } from "next/server";
import { peekOtp, type OtpPurpose } from "@/lib/accounts";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const purpose = searchParams.get("purpose") as OtpPurpose | null;
  const channel = searchParams.get("channel");
  if (!purpose || !channel || (purpose !== "shift-login" && purpose !== "consent")) {
    return NextResponse.json({ error: "purpose and channel required" }, { status: 400 });
  }
  const entry = peekOtp(purpose, channel);
  return NextResponse.json({
    code: entry?.code ?? null,
    expiresAt: entry?.expiresAt ?? null,
    simulated: true,
  });
}
