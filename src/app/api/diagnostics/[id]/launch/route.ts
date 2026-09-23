// GET /api/diagnostics/[id]/launch — launcher commands for the technician.
// The Windows commands are built HERE so their URLs are always reachable public
// origins: the diagnostic agent is downloaded from THIS app (/api/hc/launcher)
// and run against the Pockit backend (-BackendUrl = POCKIT_BASE_URL), where the
// script posts progress/complete. This avoids the backend's launcher generation
// falling back to http://localhost:<port> when PUBLIC_BASE_URL isn't set.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session-auth";
import { hcBackend, backendUrl } from "@/lib/pockit-hc";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || me.role !== "technician") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const appOrigin = (process.env.APP_BASE_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
  const backend = backendUrl("").replace(/\/+$/, ""); // e.g. https://pockit.pockitengineers.com/auth
  const scriptUrl = `${appOrigin}/api/hc/launcher`;

  // $p (temp path) is concatenated into the ArgumentList so it expands in the
  // running shell; -BackendUrl points the script's progress posts at the backend.
  const pockitArgs = `'-NoProfile -ExecutionPolicy "Bypass" -File ' + $p + ' -SessionId "${id}" -BackendUrl "${backend}"'`;
  // Unblock-File strips the Mark-of-the-Web so Windows Smart App Control / SmartScreen
  // don't block the fetched agent (the pasted command itself isn't a downloaded file).
  const dlPrefix = `$p = "$env:TEMP\\Pockit-PC-Diagnostic-V1.0.ps1"; Invoke-WebRequest -Uri '${scriptUrl}' -OutFile $p -UseBasicParsing; Unblock-File -Path $p; $pockitArgs = ${pockitArgs};`;
  const standard = `${dlPrefix} Start-Process powershell.exe -WindowStyle Minimized -ArgumentList $pockitArgs`;
  const elevated = `${dlPrefix} try { Start-Process powershell.exe -Verb RunAs -WindowStyle Minimized -ArgumentList $pockitArgs -ErrorAction Stop } catch { Start-Process powershell.exe -WindowStyle Minimized -ArgumentList $pockitArgs }`;

  // Mac: relay the backend's own launcher (best-effort — Windows is the primary path).
  let macCommand = "";
  let macDownload = "";
  try {
    const r = await hcBackend<{ launcherCurlCommand?: string; launcherCommandUrl?: string }>(
      `api/diagnostics/${encodeURIComponent(id)}`,
      { token: me.pockitToken },
    );
    if (r.ok) {
      macCommand = r.data.launcherCurlCommand ?? "";
      macDownload = r.data.launcherCommandUrl ? backendUrl(r.data.launcherCommandUrl) : "";
    }
  } catch {
    /* mac launcher is optional */
  }

  return NextResponse.json({
    windows: {
      standard,
      elevated,
      download: `${appOrigin}/api/diagnostics/${encodeURIComponent(id)}/launcher-bat`,
    },
    mac: { command: macCommand, download: macDownload },
  });
}
