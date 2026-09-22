// POST /api/diagnostics/[id]/run — the primary "Run Health Check" action for an
// existing session (post-consent wizard). Reuses the same engine launcher as the
// self-check auto flow (lib/scan.startScan) — no duplicate execution logic.
//
// The bundled engine runs the Windows PowerShell diagnostic on the HOST the app
// runs on. That's only meaningful when the app is running on the machine being
// checked (local self-hosted). On a Linux/serverless host (e.g. Vercel) the scan
// must run on the target PC via the Advanced download/paste path, so we report
// `manual_required` and let the wizard reveal that section instead of silently
// spawning nothing.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import { startScan } from "@/lib/scan";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  // Already scanned/failed → nothing to (re)launch.
  if (session.status !== "running") {
    return NextResponse.json({ ok: false, reason: "not_runnable" }, { status: 409 });
  }

  // Can only auto-launch the engine when this host is Windows (local self-check).
  if (process.platform !== "win32") {
    return NextResponse.json({ ok: false, reason: "manual_required" });
  }

  try {
    startScan(session.id, session.complaint, session.category, session.stressTest);
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: "spawn_failed", error: (err as Error).message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
