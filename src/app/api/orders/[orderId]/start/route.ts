// POST /api/orders/[orderId]/start — BFF proxy. Creates/reuses the ONE backend
// Health Check session for this order via the existing Pockit backend
// `POST /api/diagnostics` (createSession allocates DIAGNOSTIC_ID, enforces the
// JOB_CARD_ID-unique + job-started invariants). No local session is created —
// the backend is the single source of truth (Three Frontends, One Session).
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { fetchTechnicianJobs } from "@/lib/pockit";
import { hcBackend } from "@/lib/pockit-hc";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { orderId } = await ctx.params;

  // Best-effort customer context for the backend row (name/phone come from the
  // request in createSession). Read from the technician's real Pockit jobs.
  let customerName: string | null = null;
  let customerPhone: string | null = null;
  if (me.pockitToken) {
    const jobs = await fetchTechnicianJobs(me.pockitToken, me.user.id);
    const job = jobs?.find((j) => j.orderId === orderId);
    if (job) {
      customerName = job.customerName || null;
      customerPhone = job.customerMobile || null;
    }
  }

  const r = await hcBackend<{ sessionId?: string; id?: string }>("api/diagnostics", {
    method: "POST",
    token: me.pockitToken,
    body: { orderId, technicianId: me.user.id, customerName, customerPhone },
  });
  if (!r.ok) {
    // Surface the backend's own message (e.g. 409 "Start the job before
    // starting a Health Check") rather than bypassing the requirement.
    return NextResponse.json(
      { error: r.message ?? "Could not start Health Check." },
      { status: r.status >= 400 ? r.status : 409 },
    );
  }
  const sessionId = r.data.sessionId || r.data.id;
  if (!sessionId) {
    return NextResponse.json({ error: "Backend did not return a session." }, { status: 502 });
  }
  return NextResponse.json({ url: `/check/${sessionId}` });
}
