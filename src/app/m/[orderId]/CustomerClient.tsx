"use client";

import { useEffect, useState } from "react";
import type { DiagnosticReport } from "@/lib/types";
import { Report } from "@/components/Report";

interface CustomerData {
  orderId: string;
  customerName: string;
  device: string;
  consentCode: string | null;
  report: DiagnosticReport | null;
  status: string | null;
}

export function CustomerClient({ orderId }: { orderId: string }) {
  const [data, setData] = useState<CustomerData | null>(null);

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
            <span className="rounded-lg bg-brand px-2 py-1 font-display text-xs font-bold text-white">
              Pockit
            </span>
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

              {data.consentCode ? (
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
