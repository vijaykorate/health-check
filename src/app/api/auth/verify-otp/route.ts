// POST /api/auth/verify-otp — verify OTP #1 against the REAL Pockit backend
// (app/technician/verifyOTP) and issue a short-lived hc_session for that real
// technician. No dummy code, no seed accounts.
import { NextResponse } from "next/server";
import { AUTH_COOKIE, createAuthSession } from "@/lib/accounts";
import { verifyTechnicianOtp } from "@/lib/pockit";

export async function POST(request: Request) {
  let body: { mobile?: string; code?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const mobile = (body.mobile ?? "").toString().trim();
  const code = (body.code ?? "").toString().trim();
  if (!mobile || !code) {
    return NextResponse.json({ error: "Mobile and code are required" }, { status: 400 });
  }

  const result = await verifyTechnicianOtp(mobile, code);
  if (!result.ok || !result.technician) {
    return NextResponse.json(
      { error: result.message ?? "Invalid mobile or code" },
      { status: 401 },
    );
  }

  const tech = result.technician;
  const session = createAuthSession(tech.id, "technician", tech.name, tech.token);
  const res = NextResponse.json({
    ok: true,
    role: "technician",
    name: tech.name,
    redirect: "/orders",
  });
  res.cookies.set(AUTH_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return res;
}
