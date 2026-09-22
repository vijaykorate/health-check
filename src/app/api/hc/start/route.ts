// POST /api/hc/start — trusted entry for the Pockit technician app to open the
// health-check module scoped to a real order. Creates an order-linked session
// from the order context passed in (the technician app's job data — the app's
// own seed orders are not used here) and returns a launch link the app opens in
// its in-app browser. Corresponds to the rollout contract's POST /api/diagnostics
// { orderId, technicianId, … } → sessionId + link.
import { NextResponse } from "next/server";
import { createSession } from "@/lib/store";
import { createAuthSession } from "@/lib/accounts";

/** Same base-URL derivation as /api/diagnostics: honor PUBLIC_BASE_URL, else the
 *  request host, so the link points back at a reachable address. */
function baseUrlFrom(request: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

export async function POST(request: Request) {
  // Shared-secret gate: the technician app sends x-hc-api-key. Allow-with-warn
  // when HC_API_KEY is unset (local dev), reject on mismatch.
  const expected = process.env.HC_API_KEY;
  if (expected) {
    if (request.headers.get("x-hc-api-key") !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("[hc/start] HC_API_KEY not set — accepting unauthenticated start (dev only)");
  }

  let body: {
    orderId?: string;
    technicianId?: string | number;
    technicianMobile?: string;
    customerId?: string | number;
    customerName?: string;
    customerPhone?: string;
    problem?: string;
    deviceType?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const orderId = (body.orderId ?? "").toString().trim();
  const technicianId = (body.technicianId ?? "").toString().trim();
  if (!orderId || !technicianId) {
    return NextResponse.json(
      { error: "orderId and technicianId are required" },
      { status: 400 },
    );
  }

  const session = createSession({
    complaint: (body.problem ?? "").toString().trim(),
    category: "",
    stressTest: false,
    orderId,
    technicianId,
    customerId: (body.customerId ?? "").toString().trim() || null,
    customerName: (body.customerName ?? "").toString().trim() || null,
    customerMobile: (body.customerPhone ?? "").toString().trim() || null,
  });

  // Stateless launch token: a real hc_session token bound to the technician.
  // The WebView exchanges it for the session cookie at /api/hc/session.
  const token = createAuthSession(technicianId, "technician").token;
  const base = baseUrlFrom(request);
  const url = `${base}/api/hc/session?sid=${encodeURIComponent(session.id)}&t=${encodeURIComponent(token)}`;

  return NextResponse.json({ sessionId: session.id, url }, { status: 201 });
}
