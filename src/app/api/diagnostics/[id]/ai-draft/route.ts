// POST /api/diagnostics/[id]/ai-draft — BFF proxy to backend
// `POST /api/diagnostics/:id/draft-suggestion` (wizard.postDraftSuggestion).
// The backend owns the AI draft + own-data retrieval; Next.js calls no AI
// provider directly. Adapts the backend response to the panel's shape.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend } from "@/lib/pockit-hc";

interface BackendDraft {
  available?: boolean;
  similarCases?: unknown[];
  webKnowledge?: { summary?: string; sources?: unknown[] } | null;
}

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const r = await hcBackend<BackendDraft>(
    `api/diagnostics/${encodeURIComponent(id)}/draft-suggestion`,
    { method: "POST", token: me.pockitToken },
  );
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Failed to draft." },
      { status: r.status >= 400 ? r.status : 500 },
    );
  }
  const d = r.data;
  const wk = d.webKnowledge;
  return NextResponse.json({
    similarCases: Array.isArray(d.similarCases) ? d.similarCases : [],
    external: wk && wk.summary ? { summary: wk.summary, sources: wk.sources ?? [] } : null,
    aiConfigured: !!d.available,
  });
}
