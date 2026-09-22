// GET /api/health/kv — deployment diagnostic. Reports whether the shared KV is
// configured on THIS serverless instance and whether a live write→read round
// trip works. Returns no secrets. Use it to confirm cross-instance session
// storage is actually active (hit it several times; every instance must report
// kvEnabled:true). Safe to remove once the deployment is verified.
import { NextResponse } from "next/server";
import { kvEnabled, kvSet, kvGet } from "@/lib/kv";

export async function GET() {
  const enabled = kvEnabled();
  let roundTrip: { ok: boolean; error?: string } = { ok: false };
  try {
    const key = `hc:health:${crypto.randomUUID()}`;
    await kvSet(key, "ok", 30);
    roundTrip = { ok: (await kvGet(key)) === "ok" };
  } catch (err) {
    roundTrip = { ok: false, error: (err as Error).message };
  }
  return NextResponse.json({
    kvEnabled: enabled,
    provider: enabled ? "redis-rest (shared)" : "in-memory (per-instance)",
    roundTrip,
  });
}
