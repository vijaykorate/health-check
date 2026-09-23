"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PockitShield, PockitWordmark } from "@/components/Brand";

export function LoginClient() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"mobile" | "code">("mobile");
  const [agreed, setAgreed] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // OTP rate-limit is expected friction, not a failure — shown as a calm muted
  // note instead of a red error.
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // If a live session already exists, don't show the login form — send the
  // technician to their visits. This also covers the browser back/forward cache
  // (bfcache) restore, where the server component doesn't re-run, so pressing
  // Back after signing in no longer lands on the login form.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetch("/api/orders", { cache: "no-store" });
        if (!cancelled && r.ok) router.replace("/orders");
      } catch {
        /* not signed in / offline — stay on login */
      }
    };
    check();
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) check();
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onShow);
    };
  }, [router]);

  async function requestOtp() {
    if (busy || !mobile.trim() || !agreed) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = d.error ?? "Could not send code. Try again.";
        // Don't surface the backend OTP rate-limit as an error — it's expected
        // when a code was just requested. Show a calm muted note instead.
        if (/too many otp|try again after|rate limit/i.test(msg)) {
          setNotice("A code was just sent. Please wait a moment, then tap Login again.");
        } else {
          setError(msg);
        }
        return;
      }
      setStage("code");
      setHint(`Enter the code sent to your Pockit mobile app for ${mobile}.`);
    } catch {
      setError("Could not send code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, code }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Invalid mobile or code.");
        setBusy(false);
        return;
      }
      const d = (await res.json()) as { redirect: string };
      router.push(d.redirect);
    } catch {
      setError("Invalid mobile or code.");
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-surface px-6">
      {/* Soft brand blobs (match the app's welcome screen) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-28 -top-24 h-80 w-80 rounded-[42%] bg-brand/[0.06] blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-28 top-1/3 h-80 w-80 rounded-[46%] bg-brand/[0.06] blur-2xl"
      />

      {/* Brand + heading */}
      <div className="relative z-10 flex flex-col items-center pt-16 text-center">
        <PockitShield className="h-24 w-auto" />
        <PockitWordmark className="mt-4 text-2xl" />
        <h1 className="mt-10 font-display text-3xl font-bold text-brand">Welcome to Pockit!</h1>
        <p className="mt-1 font-display text-3xl font-medium text-foreground">
          {stage === "mobile" ? "Login" : "Verify OTP"}
        </p>
      </div>

      {/* Flexible gap so the form sits near the bottom, like the app */}
      <div className="flex-1" />

      {/* Form */}
      <div className="relative z-10 mx-auto w-full max-w-md pb-10">
        {stage === "mobile" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              requestOtp();
            }}
          >
            <input
              inputMode="numeric"
              autoFocus
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="Enter Email or Mobile Number"
              className="field w-full px-4 py-4 text-base text-foreground placeholder:text-muted/70"
            />

            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-foreground">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded accent-[var(--color-brand)]"
              />
              <span>
                I have read and agree to the{" "}
                <a href="#" className="text-brand underline">
                  Terms and Conditions
                </a>{" "}
                and{" "}
                <a href="#" className="text-brand underline">
                  Privacy Policy
                </a>{" "}
                of Pockit Engineers
              </span>
            </label>

            {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
            {notice ? (
              <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">{notice}</p>
            ) : null}

            <button
              type="submit"
              disabled={busy || !mobile.trim() || !agreed}
              className="btn-primary mt-6 w-full py-4 text-base font-display"
            >
              {busy ? "Sending…" : "Login"}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
          >
            <div className="flex items-center justify-between">
              <label htmlFor="code" className="text-xs font-semibold text-muted">
                One-time code
              </label>
              <button
                type="button"
                onClick={() => {
                  setStage("mobile");
                  setCode("");
                  setError(null);
                  setNotice(null);
                }}
                className="text-xs font-semibold text-brand hover:underline"
              >
                Change number
              </button>
            </div>
            <input
              id="code"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="OTP"
              className="field mt-1.5 w-full px-4 py-4 text-center font-mono text-lg tracking-[0.4em] text-foreground placeholder:tracking-normal placeholder:text-muted/70"
            />
            {hint ? (
              <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">{hint}</p>
            ) : null}
            {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="btn-primary mt-6 w-full py-4 text-base font-display"
            >
              {busy ? "Verifying…" : "Verify & sign in"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-muted">
          Sign in with your registered <b className="text-foreground">Pockit technician</b> number
        </p>
      </div>
    </main>
  );
}
