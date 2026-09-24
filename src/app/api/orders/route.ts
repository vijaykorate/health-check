// GET /api/orders — the signed-in technician's assigned Health Check jobs from
// the Pockit backend, each resolved to its real Health Check state so completed
// checks move out of "Open" into "Completed". Per-order state is read from the
// backend (single source of truth: MySQL `health_checks`) via the order-keyed
// GET /v1/orders/:orderId/health-check — no local session store.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { fetchTechnicianJobs } from "@/lib/pockit";
import { hcBackend } from "@/lib/pockit-hc";

type OrderState = "open" | "in_progress" | "completed" | "failed";

interface OrderHc {
  status?: string;
  sessionId?: string | null;
}

function mapState(backendStatus?: string): OrderState {
  switch ((backendStatus ?? "").toLowerCase()) {
    case "completed":
      return "completed";
    case "running":
    case "scanned":
      return "in_progress";
    default:
      return "open"; // NOT_STARTED / failed / unknown → startable
  }
}

export async function GET() {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!me.pockitToken) {
    return NextResponse.json({ orders: [] });
  }
  const jobs = await fetchTechnicianJobs(me.pockitToken, me.user.id);
  if (jobs === null) {
    // Pockit rejected the call (token evicted/expired) — signal re-login.
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  const token = me.pockitToken;
  const orders = await Promise.all(
    jobs.map(async (j) => {
      let state: OrderState = "open";
      let sessionId: string | null = null;
      const hc = await hcBackend<OrderHc>(
        `v1/orders/${encodeURIComponent(j.orderId)}/health-check`,
        { token },
      );
      if (hc.ok) {
        state = mapState(hc.data.status);
        sessionId = hc.data.sessionId ?? null;
      }
      return {
        orderId: j.orderId,
        customerName: j.customerName,
        deviceType: j.deviceType,
        manufacturer: j.manufacturer,
        model: j.model,
        serviceType: j.serviceType,
        territory: j.territory,
        state,
        sessionId,
        healthScore: null,
        started: j.started,
      };
    }),
  );
  return NextResponse.json({ orders });
}
