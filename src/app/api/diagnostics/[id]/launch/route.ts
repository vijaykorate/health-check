// GET /api/diagnostics/[id]/launch — BFF proxy. Relays the backend-generated
// launcher commands/links (from `GET /api/diagnostics/:id`) into the LaunchInfo
// shape the wizard already renders. The launcher points at the BACKEND origin
// and the diagnostic script posts progress/complete/fail directly to the
// backend — Next.js never generates a launcher.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend, backendUrl } from "@/lib/pockit-hc";

interface Detail {
  launcherPsCommand?: string;
  launcherPsCommandElevated?: string;
  launcherBatUrl?: string;
  launcherCurlCommand?: string;
  launcherCommandUrl?: string;
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const r = await hcBackend<Detail>(`api/diagnostics/${encodeURIComponent(id)}`, {
    token: me.pockitToken,
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Session not found." },
      { status: r.status >= 400 ? r.status : 404 },
    );
  }
  const d = r.data;
  return NextResponse.json({
    windows: {
      standard: d.launcherPsCommand ?? "",
      elevated: d.launcherPsCommandElevated ?? "",
      download: d.launcherBatUrl ? backendUrl(d.launcherBatUrl) : "",
    },
    mac: {
      command: d.launcherCurlCommand ?? "",
      download: d.launcherCommandUrl ? backendUrl(d.launcherCommandUrl) : "",
    },
  });
}
