"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type {
  ExternalReference,
  InspectionStatus,
  Severity,
  SessionView,
  SimilarCase,
} from "@/lib/types";
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
                    ? "bg-brand text-white shadow-[0_4px_12px_-4px_var(--brand)]"
                    : state === "current"
                      ? "bg-brand text-white ring-4 ring-brand/25 shadow-[0_0_0_1px_var(--brand),0_8px_20px_-6px_var(--brand)]"
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

interface AiDraft {
  similarCases: SimilarCase[];
  external: { summary: string; sources: ExternalReference[] } | null;
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
        copied
          ? "bg-ok/20 text-ok"
          : "bg-white/10 text-slate-200 hover:bg-white/20"
      }`}
    >
      {copied ? (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5" aria-hidden>
          <rect x="7" y="7" width="9" height="9" rx="2" />
          <path d="M13 4H5a1 1 0 0 0-1 1v8" strokeLinecap="round" />
        </svg>
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// Conservative, dependency-free highlighter — colors strings, $variables,
// -flags and a handful of cmdlets. Anything ambiguous stays plain, so it can't
// mangle a command the technician is about to run.
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
    <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0b0e1c] shadow-[0_16px_40px_-24px_rgba(0,0,0,0.8)]">
      <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3.5 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </span>
        <span className="ml-1 font-mono text-[11px] font-medium tracking-wide text-slate-400">
          {lang}
        </span>
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
  return (
    <span className="text-[11px] font-bold uppercase tracking-wider text-muted">{children}</span>
  );
}

// Customer-consent sync (Phase 2): the technician requests consent, the customer
// approves in their own app, and the decision flows back through the shared KV.
// This panel drives the technician side and reflects the live decision.
function ConsentPanel({
  orderId,
  onDecision,
}: {
  orderId: string;
  onDecision?: (d: "accepted" | "declined" | null) => void;
}) {
  const [requested, setRequested] = useState(false);
  const [decision, setDecision] = useState<"accepted" | "declined" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const poll = () =>
      fetch(`/api/m/${orderId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!active || !d) return;
          if (d.consentRequested) setRequested(true);
          const dec = d.consentDecision ?? null;
          setDecision(dec);
          onDecision?.(dec);
        })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 2500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [orderId, onDecision]);

  async function requestConsent() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/consent/request`, { method: "POST" });
      if (!res.ok) throw new Error(`(${res.status})`);
      setRequested(true);
    } catch {
      setError("Couldn't request consent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-5 p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/12 text-base">🔒</span>
        <div>
          <div className="font-display font-semibold text-foreground">Customer consent</div>
          <div className="text-xs text-muted">Required before the scan — approved on the customer&rsquo;s app.</div>
        </div>
        <span className="ml-auto">
          {decision === "accepted" ? (
            <span className="rounded-full bg-ok-bg px-3 py-1 text-xs font-semibold text-ok">Approved ✓</span>
          ) : decision === "declined" ? (
            <span className="rounded-full bg-bad-bg px-3 py-1 text-xs font-semibold text-bad">Declined</span>
          ) : requested ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
              Waiting for customer…
            </span>
          ) : null}
        </span>
      </div>
      {decision !== "accepted" && !requested ? (
        <button
          onClick={requestConsent}
          disabled={busy}
          className="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-60"
        >
          {busy ? "Requesting…" : "Request customer consent"}
        </button>
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

  // Launch step
  const [launch, setLaunch] = useState<LaunchInfo | null>(null);
  const [os, setOs] = useState<"windows" | "mac">("windows");
  // The scan commands are revealed only once the customer approves consent.
  const [consentAccepted, setConsentAccepted] = useState(false);
  // Primary "Run Health Check" action state.
  const [starting, setStarting] = useState(false);
  const [triggered, setTriggered] = useState(false);
  const [manualRequired, setManualRequired] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // Inspection state
  const [inspection, setInspection] = useState<Record<string, InspectionStatus>>({});
  const [observations, setObservations] = useState("");

  // Findings state
  const [primaryFinding, setPrimaryFinding] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [diagnosis, setDiagnosis] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [ai, setAi] = useState<AiDraft | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const running = view.status === "running";
  const scanDone = view.status === "scanned" || view.status === "completed";
  const handleConsentDecision = useCallback(
    (d: "accepted" | "declined" | null) => setConsentAccepted(d === "accepted"),
    [],
  );
  // Scan commands unlock once the customer approves (self-checks have no order).
  const scanUnlocked = !view.orderId || consentAccepted;

  // Fetch the launch commands for this session (used by the Advanced fallback).
  useEffect(() => {
    if (stage !== "launch" || launch) return;
    fetch(`/api/diagnostics/${id}/launch`)
      .then((r) => r.json())
      .then((d) => setLaunch(d as LaunchInfo))
      .catch(() => {});
  }, [stage, launch, id]);

  // Primary action: run the health check through the existing engine mechanism
  // (same launcher as /self-check). When the host can't launch it directly
  // (serverless), reveal the "run on the machine being checked" fallback.
  async function runHealthCheck() {
    if (starting || triggered) return;
    setStarting(true);
    setRunError(null);
    try {
      const res = await fetch(`/api/diagnostics/${id}/run`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
      };
      if (data.ok) {
        setTriggered(true);
      } else if (data.reason === "manual_required") {
        // This host can't spawn the engine (e.g. Vercel) — the scan runs on the
        // machine being checked via the command/download below.
        setManualRequired(true);
      } else {
        setRunError("Couldn't start the health check. Use the option below.");
        setManualRequired(true);
      }
    } catch {
      setRunError("Couldn't reach the server. Try again.");
    } finally {
      setStarting(false);
    }
  }

  // Advance launch → scanning → inspection off the live scan status. The scan
  // starts only once the technician runs the command, so we detect real
  // progress (percent > 0) to leave the Launch step.
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

  // generating → done after a brief beat
  useEffect(() => {
    if (stage !== "generating") return;
    const t = setTimeout(() => setStage("done"), 1600);
    return () => clearTimeout(t);
  }, [stage]);

  const issues = useMemo(
    () => Object.entries(inspection).filter(([, v]) => v === "issue"),
    [inspection],
  );

  // ── Failed ────────────────────────────────────────────────────────────────
  if (view.status === "failed") {
    return (
      <div className="mt-8 rounded-2xl bg-bad-bg p-5 text-bad">
        <div className="font-display font-semibold">Health check failed</div>
        <p className="mt-1 text-sm">{view.scanError ?? "The engine could not complete."}</p>
        <Link
          href={view.orderId ? `/orders/${view.orderId}` : "/orders"}
          className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
        >
          Back to order
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

      {/* 0 · Launch — run the scan on the machine being serviced */}
      {stage === "launch" ? (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
            Step 1 · Launch
          </div>
          <h2 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-foreground">
            Run the health check on this machine
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Once the customer approves, run the health check on the machine being serviced.
            Nothing is saved on the machine — results stream straight back here.
          </p>

          {view.orderId ? (
            <div className="mt-5">
              <ConsentPanel orderId={view.orderId} onDecision={handleConsentDecision} />
            </div>
          ) : null}

          {scanUnlocked ? (
          <>
          {/* PRIMARY action — Run Health Check (same engine as /self-check). */}
          <div className="card mt-5 p-6">
            <div className="text-[11px] font-bold uppercase tracking-wider text-brand">
              Primary
            </div>
            <h3 className="mt-1 font-display text-lg font-bold text-foreground">
              Run the health check
            </h3>
            <p className="mt-1 text-sm text-muted">
              Starts a silent diagnostic on the machine being checked. Takes ~10–70 seconds.
            </p>
            <button
              onClick={runHealthCheck}
              disabled={starting || triggered}
              className="btn-primary mt-4 w-full px-5 py-3 font-display text-base disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {starting ? "Starting…" : triggered ? "Running…" : "Run Health Check"}
            </button>
            {runError ? <p className="mt-3 text-sm text-bad">{runError}</p> : null}
            {manualRequired ? (
              <p className="mt-3 text-sm text-muted">
                This isn&rsquo;t running on the machine being checked, so start it there using{" "}
                <b className="text-foreground">Run on the machine being checked</b> below.
              </p>
            ) : null}
          </div>

          {/* ADVANCED / fallback — copy-paste command or download, run on the
              target PC (also the path used when the server can't launch it). */}
          <details className="mt-4 rounded-2xl border border-border bg-surface-2/40 p-4" open={manualRequired}>
          <summary className="cursor-pointer text-sm font-semibold text-brand">
            Run on the machine being checked (PowerShell / download / admin rights)
          </summary>
          <div className="mt-4 inline-flex rounded-xl border border-border bg-surface-2/60 p-1 shadow-inner">
            {(["windows", "mac"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOs(o)}
                className={`rounded-lg px-5 py-1.5 text-sm font-semibold transition-all duration-200 ${
                  os === o
                    ? "bg-brand text-white shadow-[0_8px_18px_-8px_var(--brand)]"
                    : "text-muted hover:text-foreground"
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
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/12 text-brand">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
                    <path d="m5 8 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M13 16h6" strokeLinecap="round" />
                  </svg>
                </span>
                <p className="text-sm text-foreground">
                  {os === "windows" ? (
                    <>Open <b>PowerShell</b> on the customer&rsquo;s Windows PC and paste:</>
                  ) : (
                    <>Open <b>Terminal</b> on the customer&rsquo;s Mac and paste:</>
                  )}
                </p>
              </div>

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

              <div className="mt-5 flex flex-col gap-2 border-t border-border pt-5">
                <a
                  href={os === "windows" ? launch.windows.download : launch.mac.download}
                  className="inline-flex w-fit items-center gap-2 rounded-xl border border-brand/50 px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/10"
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4" aria-hidden>
                    <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 15h12" strokeLinecap="round" />
                  </svg>
                  {os === "windows" ? "Download .ps1 & run instead" : "Download .sh & run instead"}
                </a>
                {os === "windows" ? (
                  <p className="text-xs leading-relaxed text-muted">
                    After it downloads, right-click the file → <b className="text-foreground">Run with PowerShell</b>. This
                    copy already knows which visit it belongs to — no extra input needed.
                  </p>
                ) : (
                  <p className="text-xs leading-relaxed text-muted">
                    Then in Terminal:{" "}
                    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-foreground">
                      chmod +x ~/Downloads/Pockit-Mac-Diagnostic.sh &amp;&amp; ~/Downloads/Pockit-Mac-Diagnostic.sh
                    </code>
                    . This copy already knows which visit it belongs to — no flags needed.
                  </p>
                )}
              </div>
            </div>
          )}
          </details>
          </>
          ) : (
            <div className="mt-5 card p-6">
              <div className="font-display font-semibold text-foreground">
                Waiting for customer consent
              </div>
              <p className="mt-1 text-sm text-muted">
                The scan commands appear here once the customer approves the health check on their
                app. Tap <b className="text-foreground">Request customer consent</b> above, then ask
                the customer to approve.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            {triggered ? (
              <span className="inline-flex items-center gap-2.5 rounded-full border border-border bg-surface-2/60 px-3.5 py-1.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
                </span>
                <span className="text-sm font-medium text-muted">Waiting for the scan to start…</span>
              </span>
            ) : null}
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
          <p className="mt-1 text-sm text-muted">
            Check each item on the machine in front of you.
          </p>
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
                              onClick={() =>
                                setInspection((s) => ({ ...s, [key]: v }))
                              }
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                                val === v
                                  ? toneClasses[tone]
                                  : "border border-border text-muted"
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
                <div className="text-xs font-bold uppercase tracking-wide text-brand">
                  From your own history
                </div>
                {ai.similarCases.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">No similar prior cases for this machine.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm text-foreground">
                    {ai.similarCases.map((c) => (
                      <li key={c.id}>• {c.diagnosis ?? c.recommendation} ({c.outcome.replace(/_/g, " ")})</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">
                  External reference (web, unverified)
                </div>
                {!ai.aiConfigured ? (
                  <p className="mt-1 text-sm text-muted">Web knowledge not configured.</p>
                ) : ai.external ? (
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
            {observations ? (
              <p className="mt-2 text-sm text-muted">{observations}</p>
            ) : null}
          </div>

          <div className="card p-4">
            <div className="font-display font-semibold text-foreground">Technician findings</div>
            <div className="mt-2 text-sm text-foreground">
              {primaryFinding || "—"}
              {severity ? (
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${toneClasses[severityTone(severity)]}`}
                >
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
            Generating the report and delivering to {view.customerName ?? "the customer"}&rsquo;s
            mobile app…
          </p>
        </div>
      ) : null}

      {/* 7 · Done */}
      {stage === "done" ? (
        <div className="rounded-2xl border border-ok/40 bg-ok-bg p-6 text-ok">
          <div className="font-display text-lg font-bold">Visit complete</div>
          <p className="mt-1 text-sm">
            The report was delivered to {view.customerName ?? "the customer"}&rsquo;s mobile app
            (+ email/WhatsApp). It is <b>not</b> downloadable on this machine.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/orders"
              className="inline-block rounded-xl bg-brand px-5 py-2.5 font-display font-semibold text-white hover:bg-brand-strong"
            >
              Back to orders
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
