// POST /api/hc/customer-launch — the Customer App calls this to open the SAME
// health-check session the technician created for an order. It never creates a
// session; it locates the technician's session by orderId, verifies the caller
// owns that order, checks eligibility/expiry, and returns a short-lived,
// order-scoped launch URL (a signed token in the query — NOT a technician
// session, NOT any backend secret).
//
// No HC_API_KEY here: the Customer App must not hold backend secrets. Ownership
// is proven by matching the caller's authenticated Pockit CUSTOMER_ID against
// the id the technician recorded on the session. (A production-hardened version
// would have the Pockit backend — the customer's auth authority — mint this
// token; that backend is out of scope here.)
import { NextResponse } from "next/server";
import { findLatestByOrder } from "@/lib/store";
import { mintOrderToken } from "@/lib/accounts";

const LAUNCH_TTL_MS = 30 * 60 * 1000; // 30 min
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // a health-check link is good for the shift/day

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
  let body: { orderId?: string; customerId?: string | number } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const orderId = (body.orderId ?? "").toString().trim();
  const customerId = (body.customerId ?? "").toString().trim();
  if (!orderId || !customerId) {
    return NextResponse.json(
      { error: "orderId and customerId are required" },
      { status: 400 },
    );
  }

  // Locate the technician-created session — never create one here.
  const session = findLatestByOrder(orderId);
  if (!session) {
    return NextResponse.json({ error: "no_health_check" }, { status: 404 });
  }

  // Ownership: the caller's customer id must match the session's. Reject unless
  // the session recorded a customer id and it matches (don't trust the client's
  // orderId alone).
  if (!session.customerId || session.customerId !== customerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Eligibility / expiry.
  if (session.status === "failed") {
    return NextResponse.json({ error: "cancelled" }, { status: 409 });
  }
  const ageMs = Date.now() - new Date(session.createdAt).getTime();
  if (ageMs > SESSION_MAX_AGE_MS) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  const token = mintOrderToken(orderId, customerId, LAUNCH_TTL_MS);
  const url = `${baseUrlFrom(request)}/m/${encodeURIComponent(orderId)}?t=${encodeURIComponent(token)}`;
  return NextResponse.json({ sessionId: session.id, url, status: session.status });
}
