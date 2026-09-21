"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SessionSummary } from "@/lib/types";
import { scoreTone } from "@/lib/score";
import { toneClasses } from "@/lib/ui";
import { SignOutButton } from "@/components/SignOutButton";

const STATUS_TONE: Record<string, string> = {
  running: "text-brand",
  scanned: "text-ok",
  completed: "text-ok",
  failed: "text-bad",
};

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

const UNASSIGNED = "Unassigned / self-service";

/** Group sessions by territory, newest-first within each; named territories
 *  alphabetical, self-service last. */
function groupByTerritory(sessions: SessionSummary[]): [string, SessionSummary[]][] {
  const map = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    const key = s.territory ?? UNASSIGNED;
    (map.get(key) ?? map.set(key, []).get(key)!).push(s);
  }
  return [...map.entries()].sort(([a], [b]) => {
    if (a === UNASSIGNED) return 1;
    if (b === UNASSIGNED) return -1;
    return a.localeCompare(b);
  });
}

export function DashboardClient() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = (await res.json()) as { sessions: SessionSummary[] };
      setSessions(data.sessions);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  async function cancel(id: string) {
    if (!confirm("Cancel this running health check? This stops the scan.")) return;
    try {
      const res = await fetch(`/api/diagnostics/${id}/cancel`, { method: "POST" });
      if (!res.ok && res.status !== 409) throw new Error(`Cancel failed (${res.status})`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-brand px-2 py-1 font-display text-sm font-bold text-white">
            id chip.ai
          </span>
          <span className="text-sm text-muted">Dashboard</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/orders" className="text-sm text-muted hover:text-foreground">
            Orders
          </Link>
          <Link
            href="/self-check"
            className="btn-primary px-4 py-2 text-sm"
          >
            + New check
          </Link>
          <SignOutButton />
        </div>
      </div>

      {error ? (
        <p className="mt-6 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>
      ) : null}

      {sessions === null ? (
        <div className="mt-20 text-center text-muted">Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="mt-20 text-center text-muted">
          No health checks yet. Run one from the{" "}
          <Link href="/self-check" className="text-brand">
            self-check page
          </Link>
          .
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {groupByTerritory(sessions).map(([territory, rows]) => (
            <section key={territory}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="font-display text-sm font-bold uppercase tracking-wide text-brand">
                  {territory}
                </h2>
                <span className="text-xs text-muted">{rows.length} check(s)</span>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-3">Machine</th>
                      <th className="px-4 py-3">Customer / complaint</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Score</th>
                      <th className="px-4 py-3">Started</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id} className="border-t border-border bg-surface">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">
                            {[s.manufacturer, s.model].filter(Boolean).join(" ") || "—"}
                          </div>
                          {s.orderId ? (
                            <div className="text-xs text-muted">{s.orderId}</div>
                          ) : null}
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-muted">
                          {s.customerName ? `${s.customerName} · ` : ""}
                          {s.complaint || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`font-semibold ${STATUS_TONE[s.status] ?? "text-muted"}`}>
                            {s.status}
                          </span>
                          {s.stalled ? (
                            <span className="ml-2 rounded-full bg-bad-bg px-2 py-0.5 text-xs font-semibold text-bad">
                              stalled
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {s.healthScore === null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${toneClasses[scoreTone(s.healthScore)]}`}
                            >
                              {s.healthScore}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted">{fmt(s.createdAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/check/${s.id}`} className="text-brand hover:underline">
                            Open
                          </Link>
                          {s.status === "running" ? (
                            <button
                              onClick={() => cancel(s.id)}
                              className="ml-3 text-bad hover:underline"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
