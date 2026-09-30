"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  | "done"
  // Optional post-completion Rescan (technician-only) — not part of the main flow.
  | "rescanlaunch"
  | "rescanning";

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
      : s === "generating" || s === "rescanlaunch" || s === "rescanning"
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
  finding: string | null;
  severity: string | null;
  diagnosis: string | null;
  recommendation: string | null;
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

// Remark input shown under an inspection item once it's flagged as an issue.
// Required when visible — `error` highlights it if the technician tries to
// continue without filling it in.
function RemarkField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
}) {
  return (
    <div className="mt-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Remark — describe the issue"
        className={`w-full rounded-lg border bg-surface p-2 text-sm text-foreground ${
          error ? "border-bad" : "border-border"
        }`}
      />
      {error ? (
        <p className="mt-1 text-xs text-bad">Please add a remark for this issue.</p>
      ) : null}
    </div>
  );
}

// (Removed) Technician Health Check shift-OTP gate ("Verify your shift"): the
// launch flow no longer requires a technician one-time code. The scan is
// authorized by the customer connecting + an admin approving consent (Approve/Deny).

// ── Customer consent (technician sends the request) ──────────────────────────
// The technician taps "Send consent to customer" — the ONLY thing that raises the
// request: POST /api/diagnostics/:id/request-consent sets CONSENT_STATUS='PENDING'
// and notifies the customer, who Approves/Declines/Later in their OWN Pockit app.
// The HC no longer auto-requests on start, so this is the single request.
// CONSENT_STATUS='APPROVED' unlocks the scan (enforced server-side).
function CustomerConsentPanel({ id, status }: { id: string; status: string | null }) {
  const approved = status === "APPROVED";
  const rejected = status === "REJECTED";
  // Persisted "waiting" state: the backend keeps CONSENT_STATUS='PENDING' from the
  // moment the request is raised until the customer decides, so deriving from the
  // status (not just local React state) means a page refresh still shows "Waiting"
  // instead of falling back to "Send consent".
  const pending = status === "PENDING";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic flag for the moment right after clicking Send, before the next poll
  // reflects PENDING. The persistent waiting state comes from `pending` above.
  const [hasSent, setHasSent] = useState(false);
  const waiting = hasSent || pending;
  // 10-second cooldown between sends so the customer isn't spammed.
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendConsent() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/diagnostics/${id}/request-consent`, { method: "POST" });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Could not send the consent request.");
      setHasSent(true);
      setCooldown(10);
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
          <div className="text-xs text-muted">
            Send the request; the customer approves it before the scan.
          </div>
        </div>
        <span className="ml-auto">
          {approved ? (
            <span className="rounded-full bg-ok-bg px-3 py-1 text-xs font-semibold text-ok">Approved ✓</span>
          ) : rejected ? (
            <span className="rounded-full bg-bad-bg px-3 py-1 text-xs font-semibold text-bad">Declined</span>
          ) : waiting ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
              Waiting for customer…
            </span>
          ) : null}
        </span>
      </div>
      {!approved ? (
        <div className="mt-4">
          <button
            onClick={sendConsent}
            disabled={busy || cooldown > 0}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
          >
            {cooldown > 0
              ? `Resend in ${cooldown}s`
              : busy
                ? "Sending…"
                : waiting
                  ? "Resend consent request to customer"
                  : "Send consent request to customer"}
          </button>
          {waiting && !rejected ? (
            <p className="mt-3 text-sm text-muted">
              Sent — waiting for the customer to Approve or Decline.
            </p>
          ) : rejected ? (
            <p className="mt-3 text-sm text-muted">
              The customer declined. Tap &ldquo;Resend consent request&rdquo; to ask again.
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
        </div>
      ) : null}
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
  // Rescan can be launched from the Orders list on a completed card via
  // /check/<id>?rescan=1 — arm it automatically (no new consent needed).
  const searchParams = useSearchParams();
  const autoRescanRef = useRef(false);

  const [launch, setLaunch] = useState<LaunchInfo | null>(null);
  const [deliverResult, setDeliverResult] = useState<{
    pdfUrl: string | null;
    emailStatus: string | null;
    whatsappStatus: string | null;
  } | null>(null);
  const [deliverError, setDeliverError] = useState<string | null>(null);
  const [os, setOs] = useState<"windows" | "mac">("windows");

  // Seed from the persisted backend state so a page refresh mid-visit restores
  // the technician's answers/remarks instead of clearing them.
  const [inspection, setInspection] = useState<Record<string, InspectionStatus>>(
    () => view.inspection ?? {},
  );
  // Free-text remark per item, captured only when an item is flagged "issue"
  // (keyed the same "Section|Label" as `inspection`).
  const [remarks, setRemarks] = useState<Record<string, string>>(() => view.remarks ?? {});
  // Keys of flagged items still missing a required remark — set on a blocked
  // Continue so those inputs can highlight.
  const [remarkErrors, setRemarkErrors] = useState<Set<string>>(new Set());
  const [observations, setObservations] = useState("");

  const [primaryFinding, setPrimaryFinding] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [diagnosis, setDiagnosis] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [ai, setAi] = useState<AiDraft | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // Guards the one-shot auto-draft when the technician first reaches Findings.
  // A ref (not state) so flipping it doesn't itself trigger a render/effect.
  const autoDraftedRef = useRef(false);

  const running = view.status === "running";
  const scanDone = view.status === "scanned" || view.status === "completed";
  // Consent is a single Approve/Deny decision (customer on-site, or admin in the
  // CRM). CONSENT_STATUS='APPROVED' is the one gate — backend-enforced in
  // scriptProgress/scriptComplete/submit; the UI only reflects it. No pairing
  // code, no shift OTP.
  const consentApproved = view.consentStatus === "APPROVED";
  const consentRejected = view.consentStatus === "REJECTED";
  const scanUnlocked = consentApproved;

  // Fetch the backend-generated launcher commands (relayed by the BFF).
  useEffect(() => {
    // Fetch the launcher command for the initial scan AND the post-completion
    // rescan launcher — otherwise a re-opened completed order (which never passes
    // through the "launch" stage) leaves `launch` null and the rescan hangs on
    // "Preparing command…".
    if ((stage !== "launch" && stage !== "rescanlaunch") || launch || !scanUnlocked) return;
    fetch(`/api/diagnostics/${id}/launch`)
      .then((r) => r.json())
      .then((d) => setLaunch(d as LaunchInfo))
      .catch(() => {});
  }, [stage, launch, id, scanUnlocked]);

  useEffect(() => {
    // Defensive consent gate: only advance to the scanning stage once consent
    // is APPROVED. A reused SESSION_ID can carry stale Mongo progress
    // (percent > 0) while consent is still PENDING/REJECTED; without this guard
    // the UI would jump straight to "scanning" ahead of consent. The backend
    // also blocks progress/complete until APPROVED — this keeps the UI honest.
    // Already reviewed + delivered: show the completion screen and never re-enter
    // the inspection/review/submit flow — re-submitting a completed session
    // errors "This session was already reviewed and submitted".
    const anyLive = view.percent > 0 || (!!view.stage && view.stage !== "connecting");
    if (view.status === "completed") {
      // The Health Check is completed and stays completed. The ONLY thing that runs
      // after this is the OPTIONAL technician Rescan, which never reopens the check.
      if (view.rescanStatus === "running") {
        // Rescan armed/in-progress → drive its sub-stages; do not force "done".
        if (anyLive && stage === "rescanlaunch") setStage("rescanning");
        return;
      }
      // Rescan finished → regenerate the delivered report so it includes the
      // Rescan Result / before-after, then return to the completion screen.
      if (stage === "rescanning") {
        // Best-effort: rebuild the delivered PDF so it includes the rescan before/after.
        void fetch(`/api/diagnostics/${id}/regenerate-report`, { method: "POST" }).catch(() => {});
        setStage("done");
        return;
      }
      // Normal completed state (also the initial landing). Don't clobber the
      // rescan launcher the technician just opened.
      if (stage !== "done" && stage !== "generating" && stage !== "rescanlaunch") setStage("done");
      return;
    }
    // Normal (original) single-scan lifecycle: launch → scanning → inspection.
    const scanLive = view.status === "running" && anyLive;
    if (scanUnlocked && scanLive && (stage === "launch" || stage === "connecting")) {
      setStage("scanning");
    }
    if (view.status === "scanned") {
      if (stage === "launch" || stage === "connecting") setStage("scanning");
      else if (stage === "scanning") setStage("inspection");
    }
  }, [view.status, view.percent, view.stage, view.rescanStatus, scanUnlocked, stage, id]);

  const checks = view.diagnostic?.Checks ?? [];
  const summary = view.diagnostic?.Summary;

  async function saveInspection() {
    // Every flagged item ("issue", incl. physical-damage "Yes") must carry a
    // remark. Block Continue and highlight the offenders if any are empty.
    const missing = new Set(
      Object.entries(inspection)
        .filter(([k, v]) => v === "issue" && !(remarks[k] ?? "").trim())
        .map(([k]) => k),
    );
    if (missing.size > 0) {
      setRemarkErrors(missing);
      return;
    }
    setRemarkErrors(new Set());
    setBusy(true);
    try {
      // Only send remarks for items that are actually flagged, so stale remarks
      // from a toggled-back item don't leak through.
      const cleanRemarks: Record<string, string> = {};
      for (const [k, v] of Object.entries(inspection)) {
        if (v === "issue" && (remarks[k] ?? "").trim()) {
          cleanRemarks[k] = remarks[k].trim();
        }
      }
      await fetch(`/api/diagnostics/${id}/inspection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspection, observations, remarks: cleanRemarks }),
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

  // Optional, technician-only Rescan AFTER completion. Does not reopen or change the
  // completed Health Check — the technician records any fixes/actions performed, then
  // arms a rescan server-side and re-runs the same command; the rescan result is
  // stored separately. Fixes + rescan appear in the report's before/after section.
  const [rescanError, setRescanError] = useState<string | null>(null);
  const [fixes, setFixes] = useState<Array<{ action: string; note: string }>>(
    () =>
      view.fixes && view.fixes.length
        ? view.fixes.map((f) => ({ action: f.action ?? "", note: f.note ?? "" }))
        : [{ action: "", note: "" }],
  );
  async function startRescan() {
    setBusy(true);
    setRescanError(null);
    try {
      // Persist the technician's fixes/actions first (best-effort — a rescan can
      // still proceed if none were recorded).
      const clean = fixes
        .map((f) => ({ action: f.action.trim(), note: f.note.trim() }))
        .filter((f) => f.action || f.note);
      if (clean.length) {
        await fetch(`/api/diagnostics/${id}/fixes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fixes: clean }),
        }).catch(() => {});
      }
      const r = await fetch(`/api/diagnostics/${id}/start-rescan`, { method: "POST" });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setRescanError(d.error ?? "Could not start the rescan.");
        return;
      }
      setStage("rescanlaunch");
    } catch {
      setRescanError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Auto-arm the rescan when opened from the Orders list (/check/<id>?rescan=1).
  // Fires once, only on an already-completed session that isn't mid-rescan. No new
  // customer consent is requested — the session is already APPROVED (backend also
  // enforces this in start-rescan).
  useEffect(() => {
    if (autoRescanRef.current) return;
    if (searchParams.get("rescan") !== "1") return;
    if (view.status !== "completed" || view.rescanStatus === "running") return;
    autoRescanRef.current = true;
    // Intentional URL-triggered action; startRescan is a stable declaration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void startRescan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, view.status, view.rescanStatus]);

  // Persist the current fixes/actions to the session envelope. Called from the
  // rescan launcher (on blur) so notes entered there reach the regenerated
  // report's before/after — the backend preserves fixes across the rescan write.
  async function saveFixes(list: { action: string; note: string }[] = fixes) {
    const clean = list
      .map((f) => ({ action: f.action.trim(), note: f.note.trim() }))
      .filter((f) => f.action || f.note);
    await fetch(`/api/diagnostics/${id}/fixes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fixes: clean }),
    }).catch(() => {});
  }

  async function draftWithAi() {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch(`/api/diagnostics/${id}/ai-draft`, { method: "POST" });
      if (!res.ok) {
        setAiError("AI could not draft suggestions — fill the fields manually.");
        return;
      }
      const draft = (await res.json()) as AiDraft;
      setAi(draft);
      let filledAny = false;
      if (draft.finding) {
        const match = FINDING_OPTIONS.find(
          (f) => f.toLowerCase() === draft.finding!.trim().toLowerCase(),
        );
        if (match) {
          setPrimaryFinding(match);
          filledAny = true;
        }
      }
      if (draft.severity) {
        const match = SEVERITIES.find(
          (s) => s.toLowerCase() === draft.severity!.trim().toLowerCase(),
        );
        if (match) {
          setSeverity(match);
          filledAny = true;
        }
      }
      if (draft.diagnosis) {
        setDiagnosis(draft.diagnosis.trim());
        filledAny = true;
      }
      if (draft.recommendation) {
        setRecommendation(draft.recommendation.trim());
        filledAny = true;
      }
      // Nothing usable came back (AI not configured, timeout, or off-format reply).
      if (!filledAny) {
        setAiError(
          draft.aiConfigured === false
            ? "AI drafting is not configured — fill the fields manually."
            : "AI could not draft suggestions — fill the fields manually.",
        );
      }
    } catch {
      setAiError("AI could not draft suggestions — fill the fields manually.");
    } finally {
      setAiLoading(false);
    }
  }

  // Auto-draft once the moment the technician lands on Findings, so the four
  // fields arrive pre-filled. The ref guard makes this fire exactly once per
  // visit — re-entering Findings from Review won't re-run it, and the manual
  // "Draft with AI" button remains for an explicit re-draft.
  useEffect(() => {
    if (stage === "findings" && !autoDraftedRef.current) {
      autoDraftedRef.current = true;
      void draftWithAi();
    }
    // draftWithAi is stable for this purpose; keying on `stage` alone is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  async function submitAndDeliver() {
    setBusy(true);
    setDeliverError(null);
    setStage("generating");
    try {
      const res = await fetch(`/api/diagnostics/${id}/deliver`, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        pdfUrl?: string | null;
        emailStatus?: string | null;
        whatsappStatus?: string | null;
      };
      if (!res.ok) {
        // Don't claim success on failure (e.g. 403 admin-consent, 409 not scanned).
        setDeliverError(d.error || "Could not submit the report. Please try again.");
        setStage("review");
        return;
      }
      setDeliverResult({
        pdfUrl: d.pdfUrl ?? null,
        emailStatus: d.emailStatus ?? null,
        whatsappStatus: d.whatsappStatus ?? null,
      });
      setStage("done");
    } catch {
      setDeliverError("Could not submit the report. Please try again.");
      setStage("review");
    } finally {
      setBusy(false);
    }
  }

  // Human-readable label for a backend delivery status (SENT / SKIPPED_* / FAILED:*).
  function deliveryLabel(status: string | null | undefined): string {
    if (!status) return "not attempted";
    if (status === "SENT") return "sent";
    if (status.startsWith("SKIPPED")) return "not configured";
    if (status.startsWith("FAILED")) return "failed";
    return status;
  }

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
            Connect the customer and get admin approval, then run the diagnostic on the machine
            being serviced. Results stream back to Pockit automatically.
          </p>

          <>
              <CustomerConsentPanel id={id} status={view.consentStatus ?? null} />

              {consentRejected && view.consentRejectReason ? (
                <div className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
                  <p className="font-semibold">Consent declined</p>
                  <p className="mt-1">Reason: {view.consentRejectReason}</p>
                </div>
              ) : null}

              {consentApproved ? (
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
                          {os === "windows" ? "Download & run (double-click)" : "Download .sh & run instead"}
                        </a>
                        {os === "windows" ? (
                          <p className="mt-2.5 text-xs text-muted">
                            Windows may ask you to confirm once, since it is a downloaded file. If
                            it says <b>&ldquo;Smart App Control blocked a file&rdquo;</b> with no
                            &ldquo;Run anyway&rdquo;, turn <b>Smart App Control</b> off on that PC
                            (Settings → Privacy &amp; security → Windows Security → App &amp; browser
                            control → Smart App Control → Off), or use the <b>PowerShell command
                            above</b> — it is not a downloaded file, so it runs regardless.
                          </p>
                        ) : null}
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
                    The scan commands appear here once the customer approves.
                  </p>
                </div>
              )}
          </>

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
                <div className="mt-2 flex flex-col gap-3">
                  {sec.items.map((item) => {
                    const key = inspectionKey(sec.section, item);
                      const val = inspection[key];
                      return (
                        <div key={key} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm text-foreground">{item}</span>
                            <div className="flex gap-1">
                              {(
                                [
                                  // Yes = the finding IS present (stored "issue" → shows a remark);
                                  // No = fine (stored "ok"). Questions are phrased so Yes = problem.
                                  ["issue", "Yes", "bad"],
                                  ["ok", "No", "ok"],
                                ] as [InspectionStatus, string, "ok" | "bad"][]
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
                          {val === "issue" ? (
                            <RemarkField
                              value={remarks[key] ?? ""}
                              error={remarkErrors.has(key)}
                              onChange={(v) => {
                                setRemarks((s) => ({ ...s, [key]: v }));
                                if (v.trim())
                                  setRemarkErrors((s) => {
                                    if (!s.has(key)) return s;
                                    const n = new Set(s);
                                    n.delete(key);
                                    return n;
                                  });
                              }}
                            />
                          ) : null}
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
          {remarkErrors.size > 0 ? (
            <p className="mt-3 text-sm text-bad">
              Add a remark for each item marked as an issue before continuing.
            </p>
          ) : null}
          <button
            onClick={saveInspection}
            disabled={busy}
            className="mt-4 rounded-xl bg-brand px-5 py-2.5 font-display font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
          >
            Continue to findings →
          </button>
        </div>
      ) : null}

      {/* R1 · Rescan launcher — re-run the SAME command after completion */}
      {stage === "rescanlaunch" ? (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">Rescan</div>
          <h2 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-foreground">
            Run a rescan on this machine
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Re-run the same diagnostic on the customer&rsquo;s PC. The result is stored as a
            separate <b>Rescan</b> — the original Health Check result is not changed.
          </p>
          {!launch ? (
            <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand" />
              Preparing command…
            </div>
          ) : (
            <div className="card mt-5 p-6">
              <div className="mb-4 inline-flex rounded-xl border border-border bg-surface-2/60 p-1 shadow-inner">
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
              {os === "windows" ? (
                <div className="space-y-5">
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
                <div>
                  <CommandLabel>macOS Terminal</CommandLabel>
                  <Terminal lang="zsh · Terminal" command={launch.mac.command} />
                </div>
              )}
            </div>
          )}
          <div className="mt-6 inline-flex items-center gap-2.5 rounded-full border border-border bg-surface-2/60 px-3.5 py-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
            </span>
            <span className="text-sm font-medium text-muted">Waiting for the rescan to start…</span>
          </div>

          {rescanError ? <p className="mt-3 text-sm text-bad">{rescanError}</p> : null}

          {/* Fixes / actions taken — saved to the session; shown in the report's before/after. */}
          <div className="mt-6 max-w-xl rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-muted">Fixes / actions taken (optional)</div>
              <button
                onClick={() => setFixes((s) => [...s, { action: "", note: "" }])}
                className="rounded-lg border border-brand px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
              >
                + Add
              </button>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {fixes.map((f, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={f.action}
                    onChange={(e) => setFixes((s) => s.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))}
                    onBlur={() => void saveFixes()}
                    placeholder="Action (e.g. Driver update)"
                    className="w-1/3 rounded-lg border border-border bg-surface p-2 text-sm text-foreground"
                  />
                  <input
                    value={f.note}
                    onChange={(e) => setFixes((s) => s.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
                    onBlur={() => void saveFixes()}
                    placeholder="What was done / observed"
                    className="flex-1 rounded-lg border border-border bg-surface p-2 text-sm text-foreground"
                  />
                  {fixes.length > 1 ? (
                    <button
                      onClick={() =>
                        setFixes((s) => {
                          const next = s.filter((_, j) => j !== i);
                          void saveFixes(next);
                          return next;
                        })
                      }
                      className="rounded-lg border border-border px-2 text-sm text-muted hover:border-bad hover:text-bad"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Record what you fixed before rescanning; it appears in the report&rsquo;s before/after.
            </p>
          </div>
        </div>
      ) : null}

      {/* R2 · Rescan progress */}
      {stage === "rescanning" ? (
        <div className="flex flex-col items-center">
          <ProgressRing percent={view.percent} label={view.stage} />
          <p className="mt-4 max-w-md text-center text-sm text-muted">Rescan · {view.message}</p>
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
              {aiLoading ? "Drafting…" : ai ? "Re-draft with AI" : "Draft with AI"}
            </button>
          </div>
          {aiLoading ? (
            <p className="mt-2 text-xs text-muted">Drafting suggestions with AI…</p>
          ) : aiError ? (
            <p className="mt-2 text-xs text-bad">{aiError}</p>
          ) : null}

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
              {QUICK_RECOMMENDATIONS.map((r) => {
                const active = recommendation === r;
                return (
                  <button
                    key={r}
                    onClick={() => setRecommendation(active ? "" : r)}
                    className={`rounded-full px-2.5 py-0.5 text-xs ${
                      active
                        ? "border border-brand bg-brand text-white"
                        : "border border-border text-muted hover:border-brand hover:text-brand"
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
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
              <ul className="mt-1 space-y-1 text-sm text-bad">
                {issues.map(([k]) => (
                  <li key={k}>
                    • {k.replace("|", " — ")}
                    {remarks[k]?.trim() ? (
                      <span className="text-muted"> — {remarks[k].trim()}</span>
                    ) : null}
                  </li>
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
            {deliverError ? (
              <p className="mb-3 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{deliverError}</p>
            ) : null}
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
          <div className="font-display text-lg font-bold">Health Check completed</div>
          {deliverResult ? (
            <>
              <p className="mt-1 text-sm">
                Health Check report generated for {view.customerName ?? "the customer"}.
              </p>
              <ul className="mt-2 space-y-0.5 text-sm">
                <li>
                  Email to customer: <b>{deliveryLabel(deliverResult.emailStatus)}</b>
                </li>
                <li>
                  WhatsApp to customer: <b>{deliveryLabel(deliverResult.whatsappStatus)}</b>
                </li>
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm">
              This Health Check is already completed and the report has been delivered to{" "}
              {view.customerName ?? "the customer"}. Nothing more to do here.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            {deliverResult?.pdfUrl ? (
              <a
                href={deliverResult.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-xl bg-brand px-5 py-2.5 font-display font-semibold text-white hover:bg-brand-strong"
              >
                View / download report
              </a>
            ) : null}
            <Link
              href="/orders"
              className="inline-block rounded-xl border border-border bg-surface px-5 py-2.5 font-display font-semibold text-foreground hover:border-brand"
            >
              Back to orders
            </Link>
          </div>

        </div>
      ) : null}
    </div>
  );
}
