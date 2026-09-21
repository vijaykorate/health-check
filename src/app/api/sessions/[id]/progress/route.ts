// POST /api/sessions/[id]/progress — progress heartbeat from the engine.
import { NextResponse } from "next/server";
import { updateProgress } from "@/lib/store";
import type { ProgressPayload } from "@/lib/types";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let payload: ProgressPayload;
  try {
    payload = (await request.json()) as ProgressPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = updateProgress(id, payload);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
