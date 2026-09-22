// POST /api/connect/pair — customer submits the 6-digit pairing code.
// BFF proxy to the backend PRE-AUTH `POST /health-check/connect/pair`
// (healthCheck.pairCode → atomic single-use claim). No login/CRM required;
// the backend resolves the session server-side from the code. This is the
// existing pairing/consent system — Next.js adds none of its own.
import { NextResponse } from "next/server";
import { hcBackend } from "@/lib/pockit-hc";

export async function POST(request: Request) {
  let body: { code?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* empty ok */
  }
  const code = (body.code ?? "").toString().trim();
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code from your technician." }, { status: 400 });
  }
  const r = await hcBackend<{
    redirectUrl?: string;
    technicianName?: string | null;
    orderRef?: string | null;
    device?: string | null;
  }>("health-check/connect/pair", { method: "POST", auth: false, body: { code } });

  if (!r.ok) {
    return NextResponse.json(
      { error: r.message ?? "Invalid code." },
      { status: r.status >= 400 ? r.status : 400 },
    );
  }
  // Derive the sessionId from the backend redirectUrl (/health-check/:id?customer=1)
  // so the customer page can poll the shared session without a second lookup.
  let sessionId: string | null = null;
  const m = (r.data.redirectUrl ?? "").match(/health-check\/([^/?]+)/);
  if (m) sessionId = decodeURIComponent(m[1]);
  return NextResponse.json({
    ok: true,
    sessionId,
    technicianName: r.data.technicianName ?? null,
    orderRef: r.data.orderRef ?? null,
    device: r.data.device ?? null,
  });
}
