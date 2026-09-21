// GET /api/launcher/sh — serves the bundled macOS diagnostic engine (feature 1).
import fs from "node:fs";
import path from "node:path";

export async function GET() {
  const scriptPath =
    process.env.POCKIT_SH ??
    path.join(process.cwd(), "scripts", "Pockit-Mac-Diagnostic-V1.0.sh");
  try {
    const body = fs.readFileSync(/*turbopackIgnore: true*/ scriptPath, "utf8");
    return new Response(body, {
      headers: {
        "Content-Type": "text/x-shellscript; charset=utf-8",
        "Content-Disposition": 'attachment; filename="Pockit-Mac-Diagnostic.sh"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Diagnostic engine not found", { status: 404 });
  }
}
