// GET /api/hc/launcher — serves the PowerShell diagnostic agent
// (scripts/Pockit-PC-Diagnostic-V1.0.ps1) as plain text. The launcher command
// downloads this and runs it with -SessionId/-BackendUrl (progress posts go
// straight to the Pockit backend). Served from THIS app so the download works
// even when the backend's own /download/launcher.ps1 is unavailable, and so the
// URL is always a reachable public origin (never localhost).
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-static";

export function GET() {
  let script: string;
  try {
    script = readFileSync(
      join(process.cwd(), "scripts", "Pockit-PC-Diagnostic-V1.0.ps1"),
      "utf8",
    );
  } catch {
    return new NextResponse("Diagnostic agent unavailable.", { status: 500 });
  }
  return new NextResponse(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
