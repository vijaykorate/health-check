// POST /api/diagnostics — create a session and either auto-launch the scan on
// this PC (mode "auto", default) or return copy-paste launch commands for a
// technician to run manually (mode "manual", feature 1).
import { NextResponse } from "next/server";
import { createSession } from "@/lib/store";
import { startScan } from "@/lib/scan";
import { buildPasteCommand } from "@/lib/launch";

/** Derive the reachable base URL from the request host (so a manual scan on
 *  another LAN machine reports back to an address it can reach). */
function backendUrlFrom(request: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

export async function POST(request: Request) {
  let body: {
    complaint?: string;
    category?: string;
    stressTest?: boolean;
    mode?: "auto" | "manual";
  } = {};
  try {
    body = await request.json();
  } catch {
    // Empty/invalid body is fine — a health check with no complaint is valid.
  }

  const complaint = (body.complaint ?? "").toString().trim();
  const category = (body.category ?? "").toString().trim();
  const stressTest = body.stressTest === true;
  const mode = body.mode === "manual" ? "manual" : "auto";

  const session = createSession({ complaint, category, stressTest });

  if (mode === "manual") {
    // Don't spawn — hand back commands the technician pastes into PowerShell.
    const backendUrl = backendUrlFrom(request);
    const common = { backendUrl, sessionId: session.id, complaint, category, stressTest };
    return NextResponse.json(
      {
        id: session.id,
        url: `/check/${session.id}`,
        launchCommand: buildPasteCommand({ ...common, elevated: false }),
        launchCommandElevated: buildPasteCommand({ ...common, elevated: true }),
      },
      { status: 201 },
    );
  }

  try {
    startScan(session.id, complaint, category, stressTest);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to start diagnostic: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { id: session.id, url: `/check/${session.id}` },
    { status: 201 },
  );
}
