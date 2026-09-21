// POST /api/diagnostics/[id]/inspection — save the physical inspection.
import { NextResponse } from "next/server";
import { setInspection } from "@/lib/store";
import type { Inspection } from "@/lib/types";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: { inspection?: Inspection; observations?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = setInspection(id, body.inspection ?? {}, body.observations?.trim() || null);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
