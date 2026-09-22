// GET /api/diagnostics/[id]/download?os=windows|mac — serves the diagnostic
// engine with THIS session's context (SessionId + BackendUrl + complaint/…)
// baked into its defaults, so a downloaded-and-run script reports back to the
// right session. The pasted one-liner passes these as args; this is the
// download-and-run equivalent.
import fs from "node:fs";
import path from "node:path";
import { getSession } from "@/lib/store";
import { bakePs1Defaults, bakeShDefaults } from "@/lib/launch";

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
  const session = await getSession(id);
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  const os = new URL(request.url).searchParams.get("os") === "mac" ? "mac" : "windows";
  const backendUrl = backendUrlFrom(request);

  const scriptPath =
    os === "mac"
      ? process.env.POCKIT_SH ??
        path.join(process.cwd(), "scripts", "Pockit-Mac-Diagnostic-V1.0.sh")
      : process.env.POCKIT_PS1 ??
        path.join(process.cwd(), "scripts", "Pockit-PC-Diagnostic-V1.0.ps1");

  let raw: string;
  try {
    raw = fs.readFileSync(/*turbopackIgnore: true*/ scriptPath, "utf8");
  } catch {
    return new Response("Diagnostic engine not found", { status: 404 });
  }

  const common = {
    sessionId: id,
    backendUrl,
    complaint: session.complaint,
    category: session.category,
  };
  const body =
    os === "mac"
      ? bakeShDefaults(raw, common)
      : bakePs1Defaults(raw, { ...common, stressTest: session.stressTest });

  return new Response(body, {
    headers: {
      "Content-Type":
        os === "mac"
          ? "text/x-shellscript; charset=utf-8"
          : "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${
        os === "mac" ? "Pockit-Mac-Diagnostic.sh" : "Pockit-PC-Diagnostic.ps1"
      }"`,
      "Cache-Control": "no-store",
    },
  });
}
