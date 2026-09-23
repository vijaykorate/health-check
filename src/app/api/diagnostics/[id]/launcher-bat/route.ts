// GET /api/diagnostics/[id]/launcher-bat — a downloadable .bat the technician
// double-clicks on the customer's Windows PC. It downloads the diagnostic agent
// from THIS app (/api/hc/launcher) and runs it against the Pockit backend
// (-BackendUrl = POCKIT_BASE_URL). A .bat auto-runs on double-click (a .ps1 only
// opens in an editor), so opening the downloaded file starts the scan.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { backendUrl } from "@/lib/pockit-hc";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const { id } = await ctx.params;
  const appOrigin = (process.env.APP_BASE_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
  const backend = backendUrl("").replace(/\/+$/, ""); // e.g. https://pockit.pockitengineers.com/auth
  const scriptUrl = `${appOrigin}/api/hc/launcher`;

  const bat = [
    "@echo off",
    "setlocal",
    `set "PS1=%TEMP%\\Pockit-PC-Diagnostic-V1.0.ps1"`,
    "echo Downloading Pockit diagnostic agent...",
    `powershell.exe -NoProfile -Command "try { Invoke-WebRequest -Uri '${scriptUrl}' -OutFile '%PS1%' -UseBasicParsing } catch { exit 1 }"`,
    "if errorlevel 1 (",
    "  echo Could not download the diagnostic agent. Check your network connection and try again.",
    "  pause",
    "  exit /b 1",
    ")",
    "echo Starting diagnostic agent...",
    `start "Pockit Diagnostic Agent" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -SessionId "${id}" -BackendUrl "${backend}" -Complaint "" -Category ""`,
    "",
  ].join("\r\n");

  return new NextResponse(bat, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="pockit-health-check.bat"`,
      "Cache-Control": "no-store",
    },
  });
}
