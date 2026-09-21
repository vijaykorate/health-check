// GET /api/diagnostics/[id] — browser poll + final result.
import { NextResponse } from "next/server";
import { getSession, toView } from "@/lib/store";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json(toView(session));
}
