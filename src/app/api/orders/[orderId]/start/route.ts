// POST /api/orders/[orderId]/start — the signed-in technician starts (or
// resumes) the health check for one of their real Pockit orders. Resolves the
// order from Pockit (their assigned jobs), reuses an existing non-cancelled
// session, else creates one, and returns the wizard URL. Cookie-authenticated;
// a technician can only start their own assigned order.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { createSession, findLatestByOrder } from "@/lib/store";
import { fetchTechnicianJobs } from "@/lib/pockit";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { orderId } = await ctx.params;

  // Reuse an existing session for this order (unless it was cancelled/failed).
  const existing = await findLatestByOrder(orderId);
  if (existing && existing.status !== "failed") {
    return NextResponse.json({ url: `/check/${existing.id}` });
  }

  // Resolve the order context and verify it belongs to this technician.
  let context: {
    customerId: string | null;
    customerName: string | null;
    customerMobile: string | null;
    complaint: string;
    territory: string | null;
  } | null = null;

  if (me.pockitToken) {
    const jobs = await fetchTechnicianJobs(me.pockitToken, me.user.id);
    if (jobs === null) {
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
    const job = jobs.find((j) => j.orderId === orderId);
    if (job) {
      context = {
        customerId: job.customerId || null,
        customerName: job.customerName || null,
        customerMobile: job.customerMobile || null,
        complaint: job.serviceType,
        territory: job.territory || null,
      };
    }
  }
  if (!context) {
    // Not one of this technician's assigned Health Check orders.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const session = await createSession({
    complaint: context.complaint,
    category: "",
    stressTest: false,
    orderId,
    technicianId: me.user.id,
    customerId: context.customerId,
    customerName: context.customerName,
    customerMobile: context.customerMobile,
    territory: context.territory,
  });

  return NextResponse.json({ url: `/check/${session.id}` });
}
