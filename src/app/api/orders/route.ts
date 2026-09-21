// GET /api/orders — the signed-in technician's orders, enriched with the
// derived state of each order's latest health-check session (for the lifecycle
// view: open → in-progress → completed).
import { NextResponse } from "next/server";
import { listOrders } from "@/lib/accounts";
import { currentUser } from "@/lib/session-auth";
import { findLatestByOrder } from "@/lib/store";

export async function GET() {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orders = listOrders(me.user.id).map((o) => {
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
