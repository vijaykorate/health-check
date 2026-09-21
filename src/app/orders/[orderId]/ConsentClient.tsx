"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Order } from "@/lib/accounts";
import { SignOutButton } from "@/components/SignOutButton";

export function ConsentClient({ order }: { order: Order }) {
  const router = useRouter();
  const [complaint, setComplaint] = useState("");
  const [stressTest, setStressTest] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestConsent() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${order.orderId}/consent/request`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Could not send consent code");
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndStart() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${order.orderId}/consent/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, complaint, stressTest }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Invalid consent code");
      }
      const d = (await res.json()) as { url: string };
      router.push(d.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <div className="flex items-center justify-between">
        <Link href="/orders" className="text-sm text-muted hover:text-foreground">
          ← Orders
        </Link>
        <SignOutButton />
      </div>

      <h1 className="mt-6 font-display text-2xl font-bold text-foreground">{order.orderId}</h1>
      <div className="mt-1 text-sm text-muted">
        {order.customerName} · {order.manufacturer} {order.model} ({order.deviceType}) ·{" "}
        {order.serviceType}
      </div>

      {/* Visit symptom */}
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <label className="block text-sm font-medium text-foreground">
          Customer&rsquo;s reported problem <span className="text-muted">(optional)</span>
        </label>
        <textarea
          value={complaint}
          onChange={(e) => setComplaint(e.target.value)}
          rows={2}
          placeholder="e.g. battery drains fast"
          className="mt-2 w-full resize-none rounded-xl border border-border bg-surface p-3 text-sm text-foreground"
        />
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={stressTest}
            onChange={(e) => setStressTest(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-brand)]"
          />
          Run extended stability test (~2–3 min)
        </label>
      </div>

      {/* Consent — OTP #2 */}
      <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand">
          Customer consent (OTP #2)
        </div>
        <p className="mt-2 text-sm text-muted">
          A consent code goes to the customer&rsquo;s mobile app. Sharing it authorizes a
          hardware &amp; software scan only — no files or personal data are touched. The customer
          reads it to you before this order&rsquo;s scan can start.
        </p>

        {!sent ? (
          <button
            onClick={requestConsent}
            disabled={busy}
            className="mt-4 rounded-xl bg-brand px-5 py-2.5 font-display font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send consent code to customer"}
          </button>
        ) : (
          <>
            <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
              Sent to the customer&rsquo;s mobile app ({order.customerMobile}).{" "}
              <Link
                href={`/m/${order.orderId}`}
                target="_blank"
                className="text-brand underline"
              >
                Open customer&rsquo;s phone (demo)
              </Link>
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && code.trim()) verifyAndStart();
              }}
            >
              <label className="mt-4 block text-xs font-semibold text-muted">
                Enter the code the customer reads out
              </label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                inputMode="numeric"
                placeholder="6-digit consent code"
                className="field mt-1 w-full p-2.5 text-center font-mono tracking-[0.3em] text-foreground placeholder:tracking-normal"
              />
              <button
                type="submit"
                disabled={busy || !code.trim()}
                className="btn-primary mt-4 w-full px-5 py-2.5 font-display"
              >
                {busy ? "Starting…" : "Verify consent & start health check"}
              </button>
            </form>
          </>
        )}

        {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
      </div>
    </main>
  );
}
