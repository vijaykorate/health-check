// POST /api/hc/otp — request the technician's Health Check shift OTP.
// BFF proxy to backend `POST /v1/technicians/:id/health-check-otp`
// (healthCheck.sendOtp) — the backend generates + pushes the OTP to the
// technician's device. Next.js generates no OTP. `:id` is the authenticated
// technician (from the session), so a technician can only request their own.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend } from "@/lib/pockit-hc";

export async function POST() {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await hcBackend(
    `v1/technicians/${encodeURIComponent(me.user.id)}/health-check-otp`,
    { method: "POST", token: me.pockitToken },
  );
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Could not send OTP." },
      { status: r.status >= 400 ? r.status : 500 },
    );
  }
  return NextResponse.json({ ok: true, message: r.message ?? "OTP sent." });
}
