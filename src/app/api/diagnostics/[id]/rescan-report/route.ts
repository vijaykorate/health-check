// GET /api/diagnostics/[id]/rescan-report — redirect to the backend's SEPARATE
// rescan (post-scan) report PDF at /reports/:id/rescan.pdf. Kept as a redirect so
// the browser fetches the PDF straight from the backend (the client never needs the
// backend origin). The backend report route is pre-auth by unguessable filename; we
// still gate this entry point on a signed-in technician.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { backendUrl } from "@/lib/pockit-hc";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  return NextResponse.redirect(backendUrl(`reports/${encodeURIComponent(id)}/rescan.pdf`));
}
