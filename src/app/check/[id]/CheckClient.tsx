"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SessionView } from "@/lib/types";
import { CATEGORIES, categoryPhase } from "@/lib/categories";
import { ProgressRing } from "@/components/ProgressRing";
import { Report } from "@/components/Report";
import { FindingsPanel } from "@/components/FindingsPanel";
import { SignOutButton } from "@/components/SignOutButton";
import { VisitWizard } from "@/components/VisitWizard";
import { BrandMark } from "@/components/Brand";

// One polling loop per /check page. Cadence is deliberately slow: a live scan
// only needs a low-frequency refresh to animate progress, and everything else
// (waiting on customer consent, launch, connect) changes even less often.
const POLL_ACTIVE_MS = 3000; // scan actively streaming progress
const POLL_WAIT_MS = 2500; // waiting on consent / launch / connect (percent 0) — snappier so the tech screen detects the customer's approval + scan start quickly
const POLL_HIDDEN_MS = 5000; // tab hidden: back off, just re-check visibility

// Session-level terminal states: once reached, the row will not change via
// polling, so we stop. A technician "cancel" sets the backend STATUS to
// 'failed', so cancelled is covered here. ('expired'/'rejected' are consent
// states, not session statuses — SessionStatus is running|scanned|completed|failed.)
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "scanned",
  "completed",
  "failed",
]);

const PHASE_STYLES: Record<string, string> = {
  queued: "opacity-50",
  running: "border-brand ring-2 ring-brand/20",
  done: "",
};

const PHASE_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running…",
  done: "Done",
};

export function CheckClient({ id }: { id: string }) {
  const [view, setView] = useState<SessionView | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    // Each mount owns its own loop state. `cancelled` is this run's liveness flag,
    // `timeoutId` is the single pending timer this run scheduled, and `inFlight`
    // guarantees we never issue two identical requests concurrently. Because the
    // next tick is scheduled ONLY after the current fetch resolves (recursive
    // setTimeout, not setInterval), there is exactly one request in flight and one
    // timer pending at any moment — one polling loop per page.
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    const schedule = (ms: number) => {
      if (cancelled) return;
      timeoutId = setTimeout(tick, ms);
    };

    async function tick() {
      if (cancelled) return;
      // Pause while the tab is hidden — just re-check visibility later, no request.
      if (typeof document !== "undefined" && document.hidden) {
        schedule(POLL_HIDDEN_MS);
        return;
      }
      // Never overlap: if a request is somehow still running, defer instead of
      // firing a second identical one.
      if (inFlight) {
        schedule(POLL_ACTIVE_MS);
        return;
      }
      inFlight = true;
      try {
        const res = await fetch(`/api/diagnostics/${id}`, { cache: "no-store" });
        if (!res.ok) {
          if (res.status === 404) throw new Error("Session not found.");
          throw new Error(`Poll failed (${res.status})`);
        }
        const data = (await res.json()) as SessionView;
        if (cancelled) return;
        setView(data);
        // Terminal session state: stop polling entirely (no reschedule).
        if (TERMINAL_STATUSES.has(data.status)) return;
        // 3s only while a scan is actively streaming progress; slower otherwise.
        const active = data.status === "running" && data.percent > 0;
        schedule(active ? POLL_ACTIVE_MS : POLL_WAIT_MS);
      } catch (e) {
        if (cancelled) return;
        setFetchError((e as Error).message);
        return; // stop on error (incl. 404) — deps are [id], so no re-arm
      } finally {
        inFlight = false;
      }
    }

    tick(); // exactly one loop starts here
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [id]);

  const running = view?.status === "running";
  const done = view?.status === "scanned" || view?.status === "completed";

  async function cancel() {
    if (!confirm("Cancel this running health check? This stops the scan.")) return;
    try {
      await fetch(`/api/diagnostics/${id}/cancel`, { method: "POST" });
    } catch {
      /* next poll reflects state */
    }
  }

  const inVisit = !!view?.orderId;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/orders" className="text-sm text-muted hover:text-foreground">
            ← Orders
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {inVisit ? <SignOutButton /> : null}
          <BrandMark />
        </div>
      </div>

      {inVisit ? (
        <div className="card relative mt-4 overflow-hidden px-5 py-4">
          <span
            className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-brand"
            aria-hidden
          />
          <span
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_120px_at_0%_0%,color-mix(in_srgb,var(--brand)_10%,transparent),transparent)]"
            aria-hidden
          />
          <div className="relative">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
              </span>
              On-site visit · running on the customer&rsquo;s machine
            </div>
            <div className="mt-1 font-display text-base font-semibold text-foreground">
              Order {view!.orderId} <span className="text-muted">·</span> {view!.customerName}
            </div>
          </div>
        </div>
      ) : null}

      {fetchError ? (
        <div className="mt-10 rounded-2xl bg-bad-bg p-5 text-bad">
          <div className="font-display font-semibold">Something went wrong</div>
          <p className="mt-1 text-sm">{fetchError}</p>
        </div>
      ) : !view ? (
        <div className="mt-20 text-center text-muted">Loading…</div>
      ) : inVisit ? (
        <VisitWizard id={id} view={view} onCancel={cancel} />
      ) : view.status === "failed" ? (
        <div className="mt-10 rounded-2xl bg-bad-bg p-5 text-bad">
          <div className="font-display font-semibold">Health check failed</div>
          <p className="mt-1 text-sm">
            {view.scanError ?? "The diagnostic engine could not complete."}
          </p>
          <Link
            href="/orders"
            className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            Back to orders
          </Link>
        </div>
      ) : done && view.diagnostic ? (
        <div className="mt-8 flex flex-col gap-6">
          <Report report={view.diagnostic} />
          {view.orderId ? (
            <div className="rounded-2xl border border-ok/40 bg-ok-bg p-4 text-ok">
              <div className="font-display font-semibold">
                Report delivered to {view.customerName ?? "the customer"}&rsquo;s mobile app
              </div>
              <p className="mt-1 text-sm">
                Sent to the customer&rsquo;s mobile app (+ email/WhatsApp). For their privacy, the
                report is <b>not</b> downloadable on this machine — hand it back to them there.
              </p>
            </div>
          ) : null}
          <FindingsPanel sessionId={id} initial={view.technician} />
          <div className="text-center">
            <Link
              href="/orders"
              className="inline-block rounded-xl bg-brand px-5 py-3 font-display font-semibold text-white hover:bg-brand-strong"
            >
              Back to orders
            </Link>
          </div>
        </div>
      ) : (
        // Running (or scanned but report not yet attached)
        <div className="mt-8 flex flex-col items-center">
          <ProgressRing percent={view.percent} label={view.stage} />
          <p className="mt-4 max-w-md text-center text-sm text-muted">
            {view.message}
          </p>
          {view.stalled ? (
            <p className="mt-2 rounded-full bg-bad-bg px-3 py-1 text-xs font-semibold text-bad">
              This scan appears stalled (running over 20 minutes).
            </p>
          ) : null}
          {running ? (
            <button
              onClick={cancel}
              className="mt-4 rounded-xl border border-bad px-4 py-2 text-sm font-semibold text-bad hover:bg-bad-bg"
            >
              Cancel scan
            </button>
          ) : null}

          <div className="mt-8 grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.filter((c) => !c.hideIfAbsent).map((cat) => {
              const phase = categoryPhase(cat, view.percent, running);
              return (
                <div
                  key={cat.key}
                  className={`rounded-2xl border border-border bg-surface p-4 transition-all ${PHASE_STYLES[phase]}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl" aria-hidden>
                      {cat.icon}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {PHASE_LABEL[phase]}
                    </span>
                  </div>
                  <div className="mt-2 font-display font-semibold text-foreground">
                    {cat.name}
                  </div>
                  <div className="text-xs text-muted">{cat.detail}</div>
                </div>
              );
            })}
          </div>

          {view.findings.length > 0 ? (
            <div className="mt-8 w-full rounded-2xl border border-border bg-surface p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                Live findings
              </div>
              <ul className="mt-2 space-y-1.5">
                {view.findings
                  .slice()
                  .reverse()
                  .map((f, i) => (
                    <li key={i} className="flex gap-2 text-sm text-foreground">
                      <span className="font-mono text-xs text-brand">
                        {f.Stage}
                      </span>
                      <span className="text-muted">{f.Text}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}
