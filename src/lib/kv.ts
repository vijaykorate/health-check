// Minimal shared key-value store for cross-instance state on serverless.
//
// Uses Upstash Redis over its REST API (no SDK dependency — just fetch) when
// credentials are present, and falls back to a globalThis-stashed in-memory Map
// otherwise. That fallback keeps local dev (single process) working exactly as
// before; on Vercel, set the env vars below to make state survive across the
// separate serverless instances that the technician and customer requests hit.
//
// Accepts either Upstash's own env vars or Vercel KV's (same REST format), so
// one adapter covers both providers:
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//   KV_REST_API_URL        / KV_REST_API_TOKEN

const REST_URL =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const REST_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";

export function kvEnabled(): boolean {
  return REST_URL !== "" && REST_TOKEN !== "";
}

// ── In-memory fallback (dev / no creds) ─────────────────────────────────────
const g = globalThis as unknown as {
  __hcKv?: Map<string, { value: string; expiresAt: number | null }>;
  __hcKvSets?: Map<string, Set<string>>;
};
const mem: Map<string, { value: string; expiresAt: number | null }> =
  g.__hcKv ?? (g.__hcKv = new Map());
const memSets: Map<string, Set<string>> =
  g.__hcKvSets ?? (g.__hcKvSets = new Map());

function memGet(key: string): string | null {
  const e = mem.get(key);
  if (!e) return null;
  if (e.expiresAt !== null && Date.now() > e.expiresAt) {
    mem.delete(key);
    return null;
  }
  return e.value;
}

// ── Upstash REST command ────────────────────────────────────────────────────
async function command(args: string[]): Promise<unknown> {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`kv ${args[0]} failed: ${res.status}`);
  }
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error(`kv ${args[0]} error: ${json.error}`);
  return json.result ?? null;
}

export async function kvSet(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  if (!kvEnabled()) {
    mem.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
    return;
  }
  await command(
    ttlSeconds ? ["SET", key, value, "EX", String(ttlSeconds)] : ["SET", key, value],
  );
}

export async function kvGet(key: string): Promise<string | null> {
  if (!kvEnabled()) return memGet(key);
  const result = await command(["GET", key]);
  return typeof result === "string" ? result : null;
}

export async function kvDel(key: string): Promise<void> {
  if (!kvEnabled()) {
    mem.delete(key);
    return;
  }
  await command(["DEL", key]);
}

/** Add a member to a set (Redis SADD). Used for the session index so the store
 *  can enumerate all sessions without a SCAN. */
export async function kvSAdd(key: string, member: string): Promise<void> {
  if (!kvEnabled()) {
    const set = memSets.get(key) ?? new Set<string>();
    set.add(member);
    memSets.set(key, set);
    return;
  }
  await command(["SADD", key, member]);
}

/** List all members of a set (Redis SMEMBERS). */
export async function kvSMembers(key: string): Promise<string[]> {
  if (!kvEnabled()) {
    return [...(memSets.get(key) ?? [])];
  }
  const result = await command(["SMEMBERS", key]);
  return Array.isArray(result) ? (result as string[]) : [];
}
