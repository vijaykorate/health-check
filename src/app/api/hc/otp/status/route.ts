// GET /api/hc/otp/status — is the technician's Health Check shift already
// verified today? BFF proxy to backend
// `GET /v1/technicians/:id/health-check-otp/status` (healthCheck.getOtpStatus).
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend } from "@/lib/pockit-hc";

export async function GET() {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await hcBackend<{ verified?: boolean }>(
    `v1/technicians/${encodeURIComponent(me.user.id)}/health-check-otp/status`,
    { token: me.pockitToken },
  );
  if (!r.ok) {
    return NextResponse.json({ verified: false }, { status: 200 });
  }
  return NextResponse.json({ verified: !!r.data.verified });
}
