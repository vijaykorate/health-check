"use client";

import { useEffect, useRef, useState } from "react";

interface Progress {
  status?: string;
  percent?: number;
  stage?: string | null;
  message?: string | null;
  overallStatus?: string | null;
  expired?: boolean;
  message_?: string;
}

// Customer pairing + live status. All state comes from the existing Pockit
// backend (via BFF proxies): POST /api/connect/pair to join the shared
// session, then poll /api/customer/[sessionId]/progress.
export function ConnectClient() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tech, setTech] = useState<{ technicianName?: string | null; device?: string | null } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const poll = () =>
      fetch(`/api/customer/${sessionId}/progress`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!active) return;
          setProgress(d as Progress);
          if (d?.expired && timer.current) clearInterval(timer.current);
        })
        .catch(() => {});
    poll();
    timer.current = setInterval(poll, 1500);
    return () => {
      active = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [sessionId]);

  async function pair() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/connect/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Invalid code.");
      setTech({ technicianName: d.technicianName, device: d.device });
      setSessionId(d.sessionId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!sessionId) {
    return (
      <div className="mt-8">
        <h1 className="font-display text-2xl font-bold text-foreground">Connect your device</h1>
        <p className="mt-2 text-sm text-muted">
          Enter the 6-digit code your technician gave you to start the health check on this device.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="6-digit code"
            className="w-44 rounded-xl border border-border bg-surface px-3 py-2 text-lg tracking-widest text-foreground"
          />
          <button
            onClick={pair}
            disabled={busy || code.length !== 6}
            className="btn-primary px-5 py-2.5 text-sm disabled:opacity-60"
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
        {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
      </div>
    );
  }

  const done = progress?.status === "scanned" || progress?.status === "completed";
  return (
    <div className="mt-8">
      <div className="rounded-2xl border border-ok/40 bg-ok-bg p-4 text-ok">
        <div className="font-display font-semibold">Connected ✓</div>
        <p className="mt-1 text-sm">
          You&rsquo;re connected{tech?.technicianName ? ` — technician ${tech.technicianName}` : ""}.
          {tech?.device ? ` Device: ${tech.device}.` : ""}
        </p>
      </div>

      {progress?.expired ? (
        <div className="mt-5 rounded-2xl bg-bad-bg p-4 text-bad">
          {progress.message ?? "This connection is no longer valid. Ask your technician for a new code."}
        </div>
      ) : done ? (
        <div className="mt-5 rounded-2xl border border-border bg-surface p-5">
          <div className="font-display font-semibold text-foreground">Health check complete</div>
          <p className="mt-1 text-sm text-muted">
            Your report is being prepared and will be sent to you. You can close this window.
          </p>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-border bg-surface p-5">
          <div className="text-sm text-muted">{progress?.message ?? "Waiting for the technician to start the scan…"}</div>
          {typeof progress?.percent === "number" ? (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
