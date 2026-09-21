// POST /api/auth/verify-otp — verify OTP #1, issue a short-lived session cookie.
// DEMO: dummy login — any mobile works with the fixed code DUMMY_OTP (123456).
import { NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  createAuthSession,
  DUMMY_OTP,
  resolveLoginUser,
} from "@/lib/accounts";

export async function POST(request: Request) {
  let body: { mobile?: string; code?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const mobile = (body.mobile ?? "").toString().trim();
  const code = (body.code ?? "").toString().trim();

  if (!mobile || code !== DUMMY_OTP) {
    return NextResponse.json({ error: "Invalid mobile or code" }, { status: 401 });
  }

  const user = resolveLoginUser(mobile);
  const session = createAuthSession(user.id, user.role);
  const res = NextResponse.json({
    ok: true,
    role: user.role,
    name: user.name,
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
