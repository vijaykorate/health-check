"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { InspectionStatus, Severity, SessionView } from "@/lib/types";
import { CATEGORIES, categoryPhase } from "@/lib/categories";
import { INSPECTION_SECTIONS, inspectionKey } from "@/lib/inspection";
import { FINDING_OPTIONS, SEVERITIES, QUICK_RECOMMENDATIONS } from "@/lib/findings-data";
import { ProgressRing } from "./ProgressRing";
import { ScoreBadge } from "./ScoreBadge";
import { OverallBadge } from "./OverallBadge";
import { StatusPill } from "./StatusPill";
import { severityTone, toneClasses } from "@/lib/ui";

type Stage =
  | "launch"
  | "connecting"
  | "scanning"
  | "inspection"
  | "findings"
  | "review"
  | "generating"
  | "done";

const FLOW: { key: Stage; label: string }[] = [
  { key: "launch", label: "Launch" },
  { key: "scanning", label: "Scan" },
  { key: "inspection", label: "Inspection" },
  { key: "findings", label: "Findings" },
  { key: "review", label: "Review" },
  { key: "done", label: "Deliver" },
];

function Stepper({ stage }: { stage: Stage }) {
  const order: Stage[] = ["launch", "scanning", "inspection", "findings", "review", "done"];
  const idxOf = (s: Stage) =>
    s === "connecting"
      ? order.indexOf("scanning")
      : s === "generating"
        ? order.indexOf("done")
        : order.indexOf(s);
  const cur = idxOf(stage);
  return (
    <div className="flex items-center overflow-x-auto pb-1">
      {FLOW.map((s, i) => {
        const state = i < cur ? "done" : i === cur ? "current" : "todo";
        return (
          <div key={s.key} className="flex shrink-0 items-center">
            <div className="flex items-center gap-2.5">
              <span
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all duration-300",
                  state === "done"
                    ? "bg-brand text-white"
                    : state === "current"
                      ? "bg-brand text-white ring-4 ring-brand/25"
                      : "border border-border bg-surface-2 text-muted",
                ].join(" ")}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span
                className={`text-xs font-semibold tracking-tight transition-colors duration-300 ${
                  state === "todo" ? "text-muted" : "text-foreground"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < FLOW.length - 1 ? (
              <span
                className={`mx-2.5 h-px w-6 rounded-full transition-colors duration-500 sm:w-10 ${
                  i < cur ? "bg-brand" : "bg-border"
                }`}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// Own-data case as returned by the backend draft-suggestion endpoint
// (keyed by DIAGNOSTIC_ID, not `id`).
interface DraftCase {
  id?: string;
  diagnosticId?: string;
  diagnosis?: string | null;
  recommendation?: string | null;
  outcome?: string | null;
}
interface AiDraft {
  similarCases: DraftCase[];
  external: { summary: string; sources: unknown[] } | null;
  /** Backend `available` — whether a draft was produced (NOT an AI-config flag). */
  aiConfigured: boolean;
}

interface LaunchInfo {
  windows: { standard: string; elevated: string; download: string };
  mac: { command: string; download: string };
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        copied ? "bg-ok/20 text-ok" : "bg-white/10 text-slate-200 hover:bg-white/20"
      }`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const CODE_RE =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\$[A-Za-z_][\w:]*)|(\s--?[A-Za-z][\w-]*)|\b(Invoke-WebRequest|Invoke-RestMethod|Start-Process|powershell\.exe|try|catch|curl|chmod)\b/g;

function highlightCommand(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  CODE_RE.lastIndex = 0;
  while ((m = CODE_RE.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className="text-emerald-300">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k++} className="text-sky-300">{m[2]}</span>);
    else if (m[3]) out.push(<span key={k++} className="text-violet-300">{m[3]}</span>);
    else if (m[4]) out.push(<span key={k++} className="text-amber-200">{m[4]}</span>);
    last = CODE_RE.lastIndex;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

function Terminal({ lang, command }: { lang: string; command: string }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0b0e1c]">
      <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3.5 py-2">
        <span className="ml-1 font-mono text-[11px] font-medium tracking-wide text-slate-400">{lang}</span>
        <span className="ml-auto">
          <CopyBtn text={command} />
        </span>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-slate-200">
        <code>{highlightCommand(command)}</code>
      </pre>
    </div>
  );
}

function CommandLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-bold uppercase tracking-wider text-muted">{children}</span>;
}

// ── Technician Health Check shift OTP (backend-owned) ───────────────────────
// Reuses the existing Pockit backend OTP (POST /api/hc/otp[/verify], status).
// A verified shift is what lets the diagnostic script's callbacks pass the
// backend's requireValidShift gate. No OTP is generated in Next.js.
function OtpGate({ onVerified }: { onVerified: () => void }) {
  const [checking, setChecking] = useState(true);
  const [sent, setSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/hc/otp/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { verified: false }))
      .then((d) => {
        if (!active) return;
        if (d.verified) onVerified();
        setChecking(false);
      })
      .catch(() => active && setChecking(false));
    return () => {
      active = false;
    };
  }, [onVerified]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/hc/otp", { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not send code.");
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/hc/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Invalid or expired code.");
      onVerified();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return <div className="card mt-5 p-6 text-sm text-muted">Checking your Health Check shift…</div>;
  }

  return (
    <div className="card mt-5 p-6">
      <div className="text-[11px] font-bold uppercase tracking-wider text-brand">Step 1 · Verify your shift</div>
      <h3 className="mt-1 font-display text-lg font-bold text-foreground">Health Check verification code</h3>
      <p className="mt-1 text-sm text-muted">
        A one-time code is pushed to your Pockit app. It unlocks Health Check for your whole shift.
      </p>
      {!sent ? (
        <button onClick={send} disabled={busy} className="btn-primary mt-4 px-5 py-2.5 text-sm disabled:opacity-60">
          {busy ? "Sending…" : "Send verification code"}
        </button>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="6-digit code"
            className="w-40 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground"
          />
          <button onClick={verify} disabled={busy || otp.length < 4} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
            {busy ? "Verifying…" : "Verify"}
          </button>
          <button onClick={send} disabled={busy} className="text-sm text-muted hover:text-foreground">
            Resend
          </button>
        </div>
      )}
      {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
    </div>
  );
}

// ── Customer pairing / consent (backend-owned) ──────────────────────────────
// Requests the 6-digit pairing code from the backend and shows it for the
// technician to read to the customer. Connection status comes from the polled
// session view (Three Frontends, One Session) — no local consent state.
function PairingPanel({ id, connected }: { id: string; connected: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/diagnostics/${id}/pairing-code`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not generate a code.");
      setCode(d.code ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-5 p-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/12 text-base">🔒</span>
        <div>
          <div className="font-display font-semibold text-foreground">Customer consent</div>
          <div className="text-xs text-muted">The customer connects with a 6-digit code — required before the scan.</div>
        </div>
        <span className="ml-auto">
          {connected ? (
            <span className="rounded-full bg-ok-bg px-3 py-1 text-xs font-semibold text-ok">Connected ✓</span>
          ) : code ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
              Waiting for customer…
            </span>
          ) : null}
        </span>
      </div>

      {!connected ? (
        code ? (
          <div className="mt-4">
            <div className="text-xs text-muted">Read this code to the customer — they enter it on their device:</div>
            <div className="mt-2 font-mono text-3xl font-bold tracking-[0.4em] text-foreground">{code}</div>
            <button onClick={generate} disabled={busy} className="mt-3 text-sm text-muted hover:text-foreground">
              {busy ? "Generating…" : "Generate a new code"}
            </button>
          </div>
        ) : (
          <button onClick={generate} disabled={busy} className="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-60">
            {busy ? "Generating…" : "Request customer consent"}
          </button>
        )
      ) : null}
      {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
    </div>
  );
}

export function VisitWizard({
  id,
  view,
  onCancel,
}: {
  id: string;
  view: SessionView;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>("launch");
  const [busy, setBusy] = useState(false);

  const [launch, setLaunch] = useState<LaunchInfo | null>(null);
  const [os, setOs] = useState<"windows" | "mac">("windows");
  const [otpVerified, setOtpVerified] = useState(false);

  const [inspection, setInspection] = useState<Record<string, InspectionStatus>>({});
  const [observations, setObservations] = useState("");

  const [primaryFinding, setPrimaryFinding] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [diagnosis, setDiagnosis] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [ai, setAi] = useState<AiDraft | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const running = view.status === "running";
  const scanDone = view.status === "scanned" || view.status === "completed";
  // Consent = the customer paired into this single backend session.
  const consentAccepted = view.customerConnectionStatus === "CONNECTED";
  // Admin consent gate (backend-enforced in scriptProgress/scriptComplete/submit);
  // the UI only reflects it. Diagnostics are shown only once an admin approves.
  const adminApproved = view.consentStatus === "APPROVED";
  const consentRejected = view.consentStatus === "REJECTED";
  const scanUnlocked = otpVerified && consentAccepted;
  // Stable callback so OtpGate's status effect doesn't re-run (and re-poll the
  // backend) on every parent re-render (CheckClient re-renders every ~1.5s).
  const handleOtpVerified = useCallback(() => setOtpVerified(true), []);

  // Fetch the backend-generated launcher commands (relayed by the BFF).
  useEffect(() => {
    if (stage !== "launch" || launch || !scanUnlocked) return;
    fetch(`/api/diagnostics/${id}/launch`)
      .then((r) => r.json())
      .then((d) => setLaunch(d as LaunchInfo))
      .catch(() => {});
  }, [stage, launch, id, scanUnlocked]);

  useEffect(() => {
    if (view.status === "running" && view.percent > 0 && (stage === "launch" || stage === "connecting")) {
      setStage("scanning");
    }
    if (scanDone && (stage === "launch" || stage === "connecting" || stage === "scanning")) {
      setStage("inspection");
    }
  }, [view.status, view.percent, scanDone, stage]);

  const checks = view.diagnostic?.Checks ?? [];
  const summary = view.diagnostic?.Summary;

  async function saveInspection() {
    setBusy(true);
    try {
      await fetch(`/api/diagnostics/${id}/inspection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspection, observations }),
      });
      setStage("findings");
    } finally {
      setBusy(false);
    }
  }

  async function saveFindings() {
    setBusy(true);
    try {
      await fetch(`/api/diagnostics/${id}/findings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryFinding, severity, diagnosis, recommendation }),
      });
      setStage("review");
    } finally {
      setBusy(false);
    }
  }

  async function draftWithAi() {
    setAiLoading(true);
    try {
      const res = await fetch(`/api/diagnostics/${id}/ai-draft`, { method: "POST" });
      if (res.ok) setAi((await res.json()) as AiDraft);
    } finally {
      setAiLoading(false);
    }
  }

  async function submitAndDeliver() {
    setBusy(true);
    setStage("generating");
    try {
      await fetch(`/api/diagnostics/${id}/deliver`, { method: "POST" });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (stage !== "generating") return;
    const t = setTimeout(() => setStage("done"), 1600);
    return () => clearTimeout(t);
  }, [stage]);

  const issues = useMemo(
    () => Object.entries(inspection).filter(([, v]) => v === "issue"),
    [inspection],
  );

  if (view.status === "failed") {
    return (
      <div className="mt-8 rounded-2xl bg-bad-bg p-5 text-bad">
        <div className="font-display font-semibold">Health check failed</div>
        <p className="mt-1 text-sm">{view.scanError ?? "The engine could not complete."}</p>
        <Link href="/orders" className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
          Back to orders
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {stage !== "connecting" ? (
        <div className="mb-5">
          <Stepper stage={stage} />
        </div>
      ) : null}

      {/* 0 · Launch */}
      {stage === "launch" ? (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">Launch</div>
          <h2 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-foreground">
            Run the health check on this machine
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Verify your shift, connect the customer, then run the diagnostic on the machine being
            serviced. Results stream back to Pockit automatically.
          </p>

          {!otpVerified ? (
            <OtpGate onVerified={handleOtpVerified} />
          ) : (
            <>
              <PairingPanel id={id} connected={consentAccepted} />

              {consentAccepted && !adminApproved ? (
                <div
                  className={`mt-5 rounded-2xl border p-5 text-sm ${
                    consentRejected
                      ? "border-red-300 bg-red-50 text-red-700"
                      : "border-amber-300 bg-amber-50 text-amber-800"
                  }`}
                >
                  {consentRejected ? (
                    <>
                      <p className="font-semibold">Consent rejected by admin</p>
                      {view.consentRejectReason ? (
                        <p className="mt-1">Reason: {view.consentRejectReason}</p>
                      ) : null}
                      <p className="mt-1">
                        This Health Check cannot proceed. Reconnect the customer to raise a new
                        request for approval.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold">Waiting for admin approval</p>
                      <p className="mt-1">
                        The customer is connected. An admin must approve this Health Check before the
                        diagnostic can run.
                      </p>
                    </>
                  )}
                </div>
              ) : null}

              {consentAccepted && adminApproved ? (
                <>
                  <div className="mt-5 inline-flex rounded-xl border border-border bg-surface-2/60 p-1 shadow-inner">
                    {(["windows", "mac"] as const).map((o) => (
                      <button
                        key={o}
                        onClick={() => setOs(o)}
                        className={`rounded-lg px-5 py-1.5 text-sm font-semibold transition-all duration-200 ${
                          os === o ? "bg-brand text-white" : "text-muted hover:text-foreground"
                        }`}
                      >
                        {o === "windows" ? "Windows" : "macOS"}
                      </button>
                    ))}
                  </div>

                  {!launch ? (
                    <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand" />
                      Preparing command…
                    </div>
                  ) : (
                    <div className="card mt-5 p-6">
                      <p className="text-sm text-foreground">
                        {os === "windows" ? (
                          <>Open <b>PowerShell</b> on the customer&rsquo;s Windows PC and paste:</>
                        ) : (
                          <>Open <b>Terminal</b> on the customer&rsquo;s Mac and paste:</>
                        )}
                      </p>
                      {os === "windows" ? (
                        <div className="mt-5 space-y-5">
                          <div>
                            <CommandLabel>Standard</CommandLabel>
                            <Terminal lang="Windows PowerShell" command={launch.windows.standard} />
                          </div>
                          <div>
                            <CommandLabel>With admin rights · UAC prompt</CommandLabel>
                            <Terminal lang="Windows PowerShell (elevated)" command={launch.windows.elevated} />
                          </div>
                        </div>
                      ) : (
                        <div className="mt-5">
                          <CommandLabel>macOS Terminal</CommandLabel>
                          <Terminal lang="zsh · Terminal" command={launch.mac.command} />
                        </div>
                      )}
                      <div className="mt-5 border-t border-border pt-5">
                        <a
                          href={os === "windows" ? launch.windows.download : launch.mac.download}
                          className="inline-flex w-fit items-center gap-2 rounded-xl border border-brand/50 px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/10"
                        >
                          {os === "windows" ? "Download .ps1 & run instead" : "Download .sh & run instead"}
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="mt-6 inline-flex items-center gap-2.5 rounded-full border border-border bg-surface-2/60 px-3.5 py-1.5">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
                    </span>
                    <span className="text-sm font-medium text-muted">Waiting for the scan to start…</span>
                  </div>
                </>
              ) : (
                <div className="mt-5 card p-6">
                  <div className="font-display font-semibold text-foreground">Waiting for customer consent</div>
                  <p className="mt-1 text-sm text-muted">
                    The scan commands appear here once the customer connects with the code above.
                  </p>
                </div>
              )}
            </>
          )}

          <div className="mt-6">
            <button
              onClick={onCancel}
              className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-bad hover:text-bad"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* 1 · Connecting */}
      {stage === "connecting" ? (
        <div className="flex flex-col items-center py-16">
          <ProgressRing percent={view.percent} label="connecting" />
          <p className="mt-4 text-sm text-muted">Connecting to this PC and starting the scan…</p>
        </div>
      ) : null}

      {/* 2 · Scanning */}
      {stage === "scanning" ? (
        <div className="flex flex-col items-center">
          <ProgressRing percent={view.percent} label={view.stage} />
          <p className="mt-4 max-w-md text-center text-sm text-muted">{view.message}</p>
          {running ? (
            <button
              onClick={onCancel}
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
                  className={`rounded-2xl border border-border bg-surface p-4 ${
                    phase === "queued" ? "opacity-50" : phase === "running" ? "border-brand" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl">{cat.icon}</span>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {phase === "queued" ? "Queued" : phase === "running" ? "Running…" : "Done"}
                    </span>
                  </div>
                  <div className="mt-2 font-display font-semibold text-foreground">{cat.name}</div>
                  <div className="text-xs text-muted">{cat.detail}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 3 · Physical inspection */}
      {stage === "inspection" ? (
        <div>
          <h2 className="font-display text-xl font-bold text-foreground">Physical inspection</h2>
          <p className="mt-1 text-sm text-muted">Check each item on the machine in front of you.</p>
          <div className="mt-4 flex flex-col gap-4">
            {INSPECTION_SECTIONS.map((sec) => (
              <div key={sec.section} className="rounded-2xl border border-border bg-surface p-4">
                <div className="font-display font-semibold text-foreground">{sec.section}</div>
                <div className="mt-2 flex flex-col gap-2">
                  {sec.items.map((item) => {
                    const key = inspectionKey(sec.section, item);
                    const val = inspection[key];
                    return (
                      <div key={key} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-foreground">{item}</span>
                        <div className="flex gap-1">
                          {(
                            [
                              ["ok", "OK", "ok"],
                              ["issue", "Issue", "bad"],
                              ["na", "N/T", "unknown"],
                            ] as [InspectionStatus, string, "ok" | "bad" | "unknown"][]
                          ).map(([v, label, tone]) => (
                            <button
                              key={v}
                              onClick={() => setInspection((s) => ({ ...s, [key]: v }))}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                                val === v ? toneClasses[tone] : "border border-border text-muted"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <textarea
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              rows={2}
              placeholder="Key observations (optional)"
              className="w-full resize-none rounded-xl border border-border bg-surface p-3 text-sm text-foreground"
            />
          </div>
          <button
            onClick={saveInspection}
            disabled={busy}
            className="mt-4 rounded-xl bg-brand px-5 py-2.5 font-display font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
          >
            Continue to findings →
          </button>
        </div>
      ) : null}

      {/* 4 · Findings */}
      {stage === "findings" ? (
        <div>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-foreground">Diagnosis & findings</h2>
            <button
              onClick={draftWithAi}
              disabled={aiLoading}
              className="rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10 disabled:opacity-60"
            >
              {aiLoading ? "Drafting…" : "Draft with AI"}
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
            <label className="block text-xs font-semibold text-muted">Primary finding</label>
            <select
              value={primaryFinding}
              onChange={(e) => setPrimaryFinding(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface p-2 text-sm text-foreground"
            >
              <option value="">—</option>
              {FINDING_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>

            <label className="mt-4 block text-xs font-semibold text-muted">Severity</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {SEVERITIES.map((s) => {
                const active = severity === s;
                return (
                  <button
                    key={s}
                    onClick={() => setSeverity(active ? "" : s)}
                    className={`rounded-full px-3 py-1 text-sm font-semibold ${
                      active ? toneClasses[severityTone(s)] : "border border-border text-muted"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>

            <label className="mt-4 block text-xs font-semibold text-muted">Diagnosis</label>
            <textarea
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              rows={2}
              className="mt-1 w-full resize-none rounded-lg border border-border bg-surface p-2 text-sm text-foreground"
            />

            <label className="mt-4 block text-xs font-semibold text-muted">Recommendation</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {QUICK_RECOMMENDATIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRecommendation(r)}
                  className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted hover:border-brand hover:text-brand"
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value)}
              rows={2}
              className="mt-1.5 w-full resize-none rounded-lg border border-border bg-surface p-2 text-sm text-foreground"
            />
          </div>

          {ai ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-brand/40 bg-brand/5 p-3">
                <div className="text-xs font-bold uppercase tracking-wide text-brand">From your own history</div>
                {ai.similarCases.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">No similar prior cases for this machine.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm text-foreground">
                    {ai.similarCases.map((c, i) => (
                      <li key={c.diagnosticId ?? c.id ?? i}>
                        • {c.diagnosis ?? c.recommendation} ({c.outcome?.replace(/_/g, " ")})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">External reference (web, unverified)</div>
                {ai.external ? (
                  <p className="mt-1 text-sm text-foreground">{ai.external.summary}</p>
                ) : (
                  <p className="mt-1 text-sm text-muted">No specific external references found.</p>
                )}
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setStage("inspection")}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted"
            >
              ← Back
            </button>
            <button
              onClick={saveFindings}
              disabled={busy}
              className="rounded-xl bg-brand px-5 py-2.5 font-display font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
            >
              Continue to review →
            </button>
          </div>
        </div>
      ) : null}

      {/* 5 · Review */}
      {stage === "review" ? (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold text-foreground">Review & deliver</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <ScoreBadge score={summary?.HealthScore ?? null} />
            <OverallBadge status={summary?.OverallStatus ?? null} />
          </div>

          <div className="card p-4">
            <div className="font-display font-semibold text-foreground">Automated checks</div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {checks.map((c) => (
                <div key={c.Area} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted">{c.Area}</span>
                  <StatusPill status={c.Status} />
                </div>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <div className="font-display font-semibold text-foreground">Physical inspection</div>
            {issues.length === 0 ? (
              <p className="mt-1 text-sm text-ok">No physical issues flagged.</p>
            ) : (
              <ul className="mt-1 text-sm text-bad">
                {issues.map(([k]) => (
                  <li key={k}>• {k.replace("|", " — ")}</li>
                ))}
              </ul>
            )}
            {observations ? <p className="mt-2 text-sm text-muted">{observations}</p> : null}
          </div>

          <div className="card p-4">
            <div className="font-display font-semibold text-foreground">Technician findings</div>
            <div className="mt-2 text-sm text-foreground">
              {primaryFinding || "—"}
              {severity ? (
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${toneClasses[severityTone(severity)]}`}>
                  {severity}
                </span>
              ) : null}
            </div>
            {diagnosis ? <p className="mt-1 text-sm text-muted">{diagnosis}</p> : null}
            {recommendation ? (
              <p className="mt-1 text-sm text-muted">
                <b>Recommendation:</b> {recommendation}
              </p>
            ) : null}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStage("findings")}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted"
            >
              ← Back
            </button>
            <button
              onClick={submitAndDeliver}
              disabled={busy}
              className="rounded-xl bg-brand px-5 py-3 font-display font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
            >
              Submit &amp; deliver to customer
            </button>
          </div>
        </div>
      ) : null}

      {/* 6 · Generating */}
      {stage === "generating" ? (
        <div className="flex flex-col items-center py-16">
          <ProgressRing percent={100} label="delivering" />
          <p className="mt-4 text-sm text-muted">
            Generating the report and delivering to {view.customerName ?? "the customer"}&rsquo;s mobile app…
          </p>
        </div>
      ) : null}

      {/* 7 · Done */}
      {stage === "done" ? (
        <div className="rounded-2xl border border-ok/40 bg-ok-bg p-6 text-ok">
          <div className="font-display text-lg font-bold">Visit complete</div>
          <p className="mt-1 text-sm">
            The report was delivered to {view.customerName ?? "the customer"}&rsquo;s mobile app (+ email/WhatsApp).
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/orders" className="inline-block rounded-xl bg-brand px-5 py-2.5 font-display font-semibold text-white hover:bg-brand-strong">
              Back to orders
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
