// POST /api/sessions/[id]/fail — the engine could not complete.
import { NextResponse } from "next/server";
import { failSession } from "@/lib/store";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: { error?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Tolerate a missing body.
  }

  const result = await failSession(id, body.error ?? "Unknown scan error");
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
