// POST /api/auth/logout — end-of-visit sign-out (clears the session + cookie).
import { NextResponse } from "next/server";
import { AUTH_COOKIE, endAuthSession } from "@/lib/accounts";
import { currentToken } from "@/lib/session-auth";

export async function POST() {
  endAuthSession(await currentToken());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
