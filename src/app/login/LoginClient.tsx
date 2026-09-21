"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginClient() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"mobile" | "code">("mobile");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestOtp() {
    if (busy || !mobile.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile }),
      });
      setStage("code");
      setHint("Demo login — enter code 123456");
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
      if (!res.ok) throw new Error("Invalid code");
      const d = (await res.json()) as { redirect: string };
      router.push(d.redirect);
    } catch {
      setError("Invalid mobile or code.");
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="rounded-xl bg-brand px-3 py-1.5 font-display text-lg font-bold text-white shadow-sm">
            id chip.ai
          </span>
          <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground">
            Technician sign-in
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {stage === "mobile"
              ? "Shift login — verify your identity to start Health Checks."
              : "Enter the one-time code to continue."}
          </p>
        </div>

        {/* Card */}
        <div className="card p-6">
          {stage === "mobile" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                requestOtp();
              }}
            >
              <label htmlFor="mobile" className="block text-xs font-semibold text-muted">
                Mobile number
              </label>
              <input
                id="mobile"
                inputMode="numeric"
                autoFocus
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="9000000001"
                className="field mt-1.5 w-full p-3 text-sm text-foreground placeholder:text-muted/60"
              />
              {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
              <button
                type="submit"
                disabled={busy || !mobile.trim()}
                className="btn-primary mt-5 w-full px-5 py-3 font-display"
              >
                {busy ? "Sending…" : "Send OTP"}
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
                <label htmlFor="code" className="block text-xs font-semibold text-muted">
                  One-time code
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setStage("mobile");
                    setCode("");
                    setError(null);
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
                placeholder="6-digit code"
                className="field mt-1.5 w-full p-3 text-center font-mono text-lg tracking-[0.4em] text-foreground placeholder:tracking-normal placeholder:text-muted/60"
              />
              {hint ? (
                <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">{hint}</p>
              ) : null}
              {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
              <button
                type="submit"
                disabled={busy || !code.trim()}
                className="btn-primary mt-5 w-full px-5 py-3 font-display"
              >
                {busy ? "Verifying…" : "Verify & sign in"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Demo — any mobile number works · code is always <b className="text-foreground">123456</b>
        </p>
      </div>
    </main>
  );
}
