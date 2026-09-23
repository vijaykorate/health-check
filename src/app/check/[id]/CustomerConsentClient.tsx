"use client";

// Customer-facing Health Check consent screen, shown inside the Pockit app's
// WebView (/check/:id?customer=1&t=...). The customer has NO technician session —
// this view only lets them Approve/Decline via the existing consent bridge
// (POST /api/hc/consent), using the order-scoped token `t`. It never shows the
// technician launcher/scan UI.
import { useEffect, useState } from "react";

interface HcStatus {
  consentRequested?: boolean;
  consentDecision?: "accepted" | "declined" | null;
  status?: string | null;
}

export function CustomerConsentClient({
  orderId,
  token,
}: {
  orderId: string;
  token: string;
}) {
  const [decision, setDecision] = useState<"accepted" | "declined" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/m/${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: HcStatus | null) => {
        if (active && d) setDecision(d.consentDecision ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [orderId]);

  async function decide(d: "accepted" | "declined") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/hc/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, decision: d, t: token }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Could not record your response. Please try again.");
      setDecision(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-6 py-10">
      <div className="card p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/12 text-2xl">
          🩺
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Health Check consent</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your technician wants to run a Health Check on this device. Approving allows a scan of
          hardware &amp; software only — no files or personal data are accessed.
        </p>

        {decision === "accepted" ? (
          <div className="mt-6 rounded-xl bg-ok-bg p-4 text-sm font-semibold text-ok">
            ✓ Approved — thank you. Your technician can now run the Health Check.
          </div>
        ) : decision === "declined" ? (
          <div className="mt-6">
            <div className="rounded-xl bg-bad-bg p-4 text-sm font-semibold text-bad">
              You declined this Health Check.
            </div>
            <button
              onClick={() => decide("accepted")}
              disabled={busy}
              className="btn-primary mt-4 w-full py-3 text-sm disabled:opacity-60"
            >
              {busy ? "Please wait…" : "Approve instead"}
            </button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={() => decide("accepted")}
              disabled={busy}
              className="btn-primary w-full py-3.5 text-base font-display disabled:opacity-60"
            >
              {busy ? "Please wait…" : "Approve Health Check"}
            </button>
            <button
              onClick={() => decide("declined")}
              disabled={busy}
              className="w-full rounded-xl border border-border py-3 text-sm font-semibold text-muted disabled:opacity-60"
            >
              Decline
            </button>
          </div>
        )}
        {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
      </div>
    </main>
  );
}
