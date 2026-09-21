// GET /api/diagnostics/[id]/launch — copy-paste commands + download links for
// the technician to run the scan on the machine being serviced (Win & Mac).
import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import { buildPasteCommand, buildMacCommand } from "@/lib/launch";

function backendUrlFrom(request: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const backendUrl = backendUrlFrom(request);
  const common = {
    backendUrl,
    sessionId: id,
    complaint: session.complaint,
    category: session.category,
  };
  return NextResponse.json({
    windows: {
      standard: buildPasteCommand({ ...common, stressTest: session.stressTest, elevated: false }),
      elevated: buildPasteCommand({ ...common, stressTest: session.stressTest, elevated: true }),
      download: "/api/launcher/ps1?download=1",
    },
    mac: {
      command: buildMacCommand(common),
      download: "/api/launcher/sh",
    },
  });
}
