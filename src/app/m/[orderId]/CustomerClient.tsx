"use client";

import { useEffect, useState } from "react";
import type { DiagnosticReport } from "@/lib/types";
import { Report } from "@/components/Report";
import { BrandMark } from "@/components/Brand";

interface CustomerData {
  orderId: string;
  customerName: string;
  device: string;
  consentRequested?: boolean;
  consentCode: string | null;
  consentDecision?: "accepted" | "declined" | null;
  report: DiagnosticReport | null;
  status: string | null;
}

export function CustomerClient({ orderId }: { orderId: string }) {
  const [data, setData] = useState<CustomerData | null>(null);
  // Launch token from /api/hc/customer-launch (present when opened from the
  // Customer App). It authorizes this customer to decide consent for this order.
  // Read once at init (SSR-guarded); the consent UI only renders after `data`
  // loads, so this never causes a hydration mismatch.
  const [token] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return new URLSearchParams(window.location.search).get("t");
    } catch {
      return null;
    }
  });
  const [deciding, setDeciding] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  async function decide(decision: "accepted" | "declined") {
    if (!token || deciding) return;
    setDeciding(true);
    setConsentError(null);
    try {
      const res = await fetch(`/api/hc/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, decision, t: token }),
      });
      if (!res.ok) throw new Error(`(${res.status})`);
      // Reflect immediately; the poll will confirm from the shared KV.
      setData((d) => (d ? { ...d, consentDecision: decision } : d));
    } catch {
      setConsentError("Couldn't record your response. Check your connection and try again.");
    } finally {
      setDeciding(false);
    }
  }

  function downloadJson() {
    if (!data?.report) return;
    const blob = new Blob([JSON.stringify(data.report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `health-report-${orderId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch(`/api/m/${orderId}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => active && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 2500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [orderId]);

  const wide = !!data?.report;

  return (
    <main
      className={`mx-auto flex w-full flex-1 flex-col px-4 py-8 ${wide ? "max-w-2xl" : "max-w-md"}`}
    >
      <div className="card overflow-hidden">
        {/* App bar */}
        <div className="flex items-center justify-between border-b border-border bg-surface-2 px-5 py-3">
          <div className="flex items-center gap-2">
            <BrandMark />
            <span className="text-xs font-medium text-muted">Customer app</span>
          </div>
          <span className="text-[11px] text-muted">{data?.device ?? ""}</span>
        </div>

        <div className="p-5">
          {!data ? (
            <div className="py-20 text-center text-sm text-muted">Loading…</div>
          ) : data.report ? (
            // Final report — the only thing shown once the scan completes.
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ok-bg text-lg text-ok">
                  ✓
                </span>
                <div className="mr-auto">
                  <h1 className="font-display text-lg font-bold text-foreground">
                    Your health report
                  </h1>
                  <p className="text-xs text-muted">
                    {data.device} · order {data.orderId}
                  </p>
                </div>
                <div className="no-print flex gap-2">
                  <button
                    onClick={() => window.print()}
                    className="btn-primary px-3.5 py-2 text-sm"
                  >
                    🖨 Save as PDF
                  </button>
                  <button
                    onClick={downloadJson}
                    className="rounded-xl border border-border px-3.5 py-2 text-sm font-semibold text-foreground hover:border-brand"
                  >
                    ⤓ JSON
                  </button>
                </div>
              </div>
              <Report report={data.report} />
            </div>
          ) : (
            // Consent code — the only thing shown before/while the scan runs.
            <div className="text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-2xl">
                🔒
              </span>
              <h1 className="mt-4 font-display text-xl font-bold text-foreground">
                Consent to a health check
              </h1>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
                Sharing this code with the Pockit technician allows a scan of{" "}
                <b className="text-foreground">hardware &amp; software only</b> — no files or
                personal information are touched.
              </p>

              {data.consentDecision === "accepted" ? (
                // Customer approved in-app — the technician's wizard continues.
                <div className="mt-6 rounded-2xl border border-ok/40 bg-ok-bg p-5 text-ok">
                  <div className="font-display font-semibold">You approved the health check ✓</div>
                  <p className="mt-1 text-sm">
                    The technician can now run the scan. You can keep this screen open — your
                    report will appear here when it&rsquo;s ready.
                  </p>
                </div>
              ) : data.consentDecision === "declined" ? (
                <div className="mt-6 rounded-2xl border border-bad/40 bg-bad-bg p-5 text-bad">
                  <div className="font-display font-semibold">You declined</div>
                  <p className="mt-1 text-sm">No scan will run. You can approve below if you change your mind.</p>
                  <button
                    onClick={() => decide("accepted")}
                    disabled={deciding || !token}
                    className="btn-primary mt-3 px-4 py-2 text-sm disabled:opacity-60"
                  >
                    {deciding ? "Sending…" : "Approve instead"}
                  </button>
                </div>
              ) : token && data.consentRequested ? (
                // Launched from the Customer App with a valid token → decide in-app.
                <div className="mt-6 rounded-2xl border border-brand/30 bg-brand/5 p-5">
                  <div className="text-sm text-foreground">
                    Your technician has requested a health check on this device. Approving allows a
                    scan of <b>hardware &amp; software only</b>.
                  </div>
                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={() => decide("accepted")}
                      disabled={deciding}
                      className="btn-primary flex-1 px-4 py-3 font-display disabled:opacity-60"
                    >
                      {deciding ? "Sending…" : "Approve health check"}
                    </button>
                    <button
                      onClick={() => decide("declined")}
                      disabled={deciding}
                      className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-semibold text-muted disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                  {consentError ? <p className="mt-3 text-sm text-bad">{consentError}</p> : null}
                </div>
              ) : data.consentCode ? (
                // No launch token (read-aloud fallback): show the code to relay verbally.
                <div className="mt-6 rounded-2xl border border-brand/30 bg-brand/5 p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-brand">
                    Your consent code
                  </div>
                  <div className="mt-2 flex justify-center gap-2">
                    {data.consentCode.split("").map((d, i) => (
                      <span
                        key={i}
                        className="flex h-12 w-9 items-center justify-center rounded-lg border border-brand/30 bg-surface font-mono text-2xl font-bold text-foreground"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 text-[11px] text-muted">Read this to your technician</div>
                </div>
              ) : (
                <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-surface-2 p-5 text-sm text-muted">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
                  Waiting for the technician to request consent…
                </div>
              )}

              <p className="mt-5 text-xs text-muted">
                For {data.customerName} · {data.device}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
