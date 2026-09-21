// POST /api/auth/request-otp — technician/admin shift login, OTP #1 (identity).
import { NextResponse } from "next/server";
import { findUserByMobile, issueOtp } from "@/lib/accounts";

export async function POST(request: Request) {
  let body: { mobile?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }
  const mobile = (body.mobile ?? "").toString().trim();
  const user = findUserByMobile(mobile);
  // Don't reveal whether a mobile exists; always report "sent".
  if (user) issueOtp("shift-login", mobile);
  return NextResponse.json({ ok: true, sent: true });
}
