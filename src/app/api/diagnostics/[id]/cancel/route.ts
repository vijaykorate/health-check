// POST /api/diagnostics/[id]/cancel — cancel a running scan (feature 5).
import { NextResponse } from "next/server";
import { cancelSession } from "@/lib/store";
import { killScanProcess } from "@/lib/kill";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  // Mark failed first (only valid while running); then stop the real process.
  const result = cancelSession(id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "not_found" ? 404 : 409 },
    );
  }
  killScanProcess(id);
  return NextResponse.json({ ok: true });
}
