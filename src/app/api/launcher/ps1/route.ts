// GET /api/launcher/ps1 — serves the bundled diagnostic engine as text so a
// pasted PowerShell one-liner can fetch it (feature 1).
import fs from "node:fs";
import path from "node:path";

export async function GET(request: Request) {
  const download = new URL(request.url).searchParams.has("download");
  const scriptPath =
    process.env.POCKIT_PS1 ??
    path.join(process.cwd(), "scripts", "Pockit-PC-Diagnostic-V1.0.ps1");
  try {
    const body = fs.readFileSync(/*turbopackIgnore: true*/ scriptPath, "utf8");
    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    };
    if (download) {
      headers["Content-Disposition"] =
        'attachment; filename="Pockit-PC-Diagnostic.ps1"';
    }
    return new Response(body, { headers });
  } catch {
    return new Response("Diagnostic engine not found", { status: 404 });
  }
}
