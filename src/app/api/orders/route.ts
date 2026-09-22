// GET /api/orders — the signed-in technician's assigned Health Check jobs from
// the Pockit backend. Per-order Health Check state now lives entirely in the
// backend (resolved when the technician opens/starts a check), so this route
// only lists the jobs — no local session store.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { fetchTechnicianJobs } from "@/lib/pockit";

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
  const orders = jobs.map((j) => ({
    orderId: j.orderId,
    customerName: j.customerName,
    deviceType: j.deviceType,
    manufacturer: j.manufacturer,
    model: j.model,
    serviceType: j.serviceType,
    territory: j.territory,
    // Lifecycle state is owned by the backend session; the wizard resolves it.
    state: "open" as const,
    sessionId: null,
    healthScore: null,
  }));
  return NextResponse.json({ orders });
}
