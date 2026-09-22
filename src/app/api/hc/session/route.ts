// GET /api/hc/session?sid=<sessionId>&t=<token> — the launch link opened by the
// technician app's in-app browser. Exchanges the signed launch token for the
// hc_session cookie (so the WebView is authenticated without a manual login),
// then redirects into the wizard for the session.
import { NextResponse } from "next/server";
import { AUTH_COOKIE, getAuthSession } from "@/lib/accounts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sid = url.searchParams.get("sid") ?? "";
  const token = url.searchParams.get("t") ?? "";

  // Validate the token via the same stateless verifier the app already trusts.
  const session = getAuthSession(token);
  if (!session || !sid) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const res = NextResponse.redirect(new URL(`/check/${encodeURIComponent(sid)}`, url.origin));
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return res;
}
