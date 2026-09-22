// GET /api/orders — the signed-in technician's orders, enriched with the
// derived state of each order's latest health-check session (for the lifecycle
// view: open → in-progress → completed).
import { NextResponse } from "next/server";
import { type Order } from "@/lib/accounts";
import { currentUser } from "@/lib/session-auth";
import { findLatestByOrder } from "@/lib/store";
import { fetchTechnicianJobs } from "@/lib/pockit";

export async function GET() {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A technician's assigned Health Check jobs come from the Pockit backend,
  // using the token carried in the session.
  type OrderRow = Pick<
    Order,
    "orderId" | "customerName" | "deviceType" | "manufacturer" | "model" | "serviceType" | "territory"
  >;
  let baseOrders: OrderRow[] = [];
  if (me.pockitToken) {
    const jobs = await fetchTechnicianJobs(me.pockitToken, me.user.id);
    if (jobs === null) {
      // Pockit rejected the call (token evicted/expired) — signal a re-login
      // rather than showing a misleading "no orders assigned".
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
    baseOrders = jobs.map((j) => ({
      orderId: j.orderId,
      customerName: j.customerName,
      deviceType: j.deviceType,
      manufacturer: j.manufacturer,
      model: j.model,
      serviceType: j.serviceType,
      territory: j.territory,
    }));
  }

  const orders = baseOrders.map((o) => {
    const session = findLatestByOrder(o.orderId);
    let state: "open" | "in_progress" | "completed" | "failed" = "open";
    if (session) {
      if (session.status === "running") state = "in_progress";
      else if (session.status === "scanned" || session.status === "completed")
        state = "completed";
      else if (session.status === "failed") state = "open"; // can retry
    }
    return {
      ...o,
      state,
      sessionId: session?.id ?? null,
      healthScore: session?.healthScore ?? null,
    };
  });

  return NextResponse.json({ orders });
}
