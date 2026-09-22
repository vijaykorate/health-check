// POST /api/diagnostics/[id]/cancel — BFF proxy to backend
// `POST /api/diagnostics/:id/cancel` (wizard.postCancel). Backend flips the
// session to failed + best-effort kills the process. No local state.
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
  const r = await hcBackend(`api/diagnostics/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    token: me.pockitToken,
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Could not cancel." },
      { status: r.status >= 400 ? r.status : 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
