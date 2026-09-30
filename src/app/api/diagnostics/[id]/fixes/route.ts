// POST /api/diagnostics/[id]/fixes — BFF proxy to backend
// `POST /api/diagnostics/:id/fixes` (wizard.postFixes): records the technician's
// fixes/actions performed between the original scan and the rescan (post-scan).
// Stored in the INSPECTION_JSON envelope; shown in the report's Fixes section.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend } from "@/lib/pockit-hc";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: { fixes?: Array<{ action?: string; note?: string }> } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body ok */
  }
  const r = await hcBackend(`api/diagnostics/${encodeURIComponent(id)}/fixes`, {
    method: "POST",
    token: me.pockitToken,
    body: { fixes: Array.isArray(body.fixes) ? body.fixes : [] },
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Failed to save fixes." },
      { status: r.status >= 400 ? r.status : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
