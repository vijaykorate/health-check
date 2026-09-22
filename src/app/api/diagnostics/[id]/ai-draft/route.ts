// POST /api/diagnostics/[id]/ai-draft — feature 6.
// Two independent, best-effort sources feed the AI-drafted diagnosis, kept
// separate: (a) own-data retrieval from local history, (b) grounded web
// knowledge. One failing never blocks the other.
import { NextResponse } from "next/server";
import { getSession, findSimilarCases } from "@/lib/store";
import { searchKnowledgeBase, aiConfigured } from "@/lib/ai";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const category = session.diagnostic?.Complaint?.Category ?? session.category ?? null;

  // (a) own history — from the shared session store.
  const similarCases = await findSimilarCases({
    manufacturer: session.manufacturer,
    model: session.model,
    category,
    excludeSessionId: id,
  });

  // (b) grounded web knowledge — async, best-effort.
  let external = null;
  try {
    external = await searchKnowledgeBase({
      manufacturer: session.manufacturer,
      model: session.model,
      category,
      problem: session.complaint || null,
    });
  } catch {
    external = null;
  }

  return NextResponse.json({
    similarCases,
    external,
    aiConfigured: aiConfigured(),
  });
}
