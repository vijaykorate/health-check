// POST /api/diagnostics/[id]/start-rescan — BFF proxy to backend
// `POST /api/diagnostics/:id/start-rescan` (wizard.startRescan): arms an OPTIONAL
// technician-only rescan AFTER completion. Does not reopen or change the completed
// Health Check; the rescan result is stored separately (RESCAN_JSON).
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend } from "@/lib/pockit-hc";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const r = await hcBackend(`api/diagnostics/${encodeURIComponent(id)}/start-rescan`, {
    method: "POST",
    token: me.pockitToken,
    body: {},
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Could not start the rescan." },
      { status: r.status >= 400 ? r.status : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
