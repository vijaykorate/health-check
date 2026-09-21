"use client";

import { useEffect, useMemo, useState } from "react";
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
    <div className="flex items-center gap-2 overflow-x-auto py-1">
      {FLOW.map((s, i) => {
        const state = i < cur ? "done" : i === cur ? "current" : "todo";
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                state === "done"
                  ? "bg-ok text-white"
                  : state === "current"
                    ? "bg-brand text-white"
                    : "bg-surface-2 text-muted"
              }`}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span
              className={`text-xs font-semibold ${state === "todo" ? "text-muted" : "text-foreground"}`}
            >
              {s.label}
            </span>
            {i < FLOW.length - 1 ? <span className="text-muted">·</span> : null}
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
      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <CopyBtn text={command} />
      </div>
      <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-foreground">
        {command}
      </pre>
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

  // Fetch the launch commands for this session.
  useEffect(() => {
    if (stage !== "launch" || launch) return;
    fetch(`/api/diagnostics/${id}/launch`)
      .then((r) => r.json())
      .then((d) => setLaunch(d as LaunchInfo))
      .catch(() => {});
  }, [stage, launch, id]);

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
          <h2 className="font-display text-xl font-bold text-foreground">
            Run the health check on this machine
          </h2>
          <p className="mt-1 text-sm text-muted">
            Paste the command into an open terminal, or download and run the file. Nothing is
            saved on the machine — results stream straight back here.
          </p>

          <div className="mt-4 inline-flex rounded-xl border border-border bg-surface p-1">
            {(["windows", "mac"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOs(o)}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${
                  os === o ? "bg-brand text-white" : "text-muted"
                }`}
              >
                {o === "windows" ? "Windows" : "macOS"}
              </button>
            ))}
          </div>

          {!launch ? (
            <p className="mt-4 text-sm text-muted">Preparing command…</p>
          ) : os === "windows" ? (
            <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
              <p className="text-sm text-foreground">
                Open <b>PowerShell</b> on the customer&rsquo;s Windows PC and paste:
              </p>
              <CommandBlock label="Standard" command={launch.windows.standard} />
              <CommandBlock label="With admin rights (UAC prompt)" command={launch.windows.elevated} />
              <a
                href={launch.windows.download}
                className="mt-3 inline-block rounded-xl border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/10"
              >
                ↓ Download .ps1 &amp; run instead
              </a>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
              <p className="text-sm text-foreground">
                Open <b>Terminal</b> on the customer&rsquo;s Mac and paste:
              </p>
              <CommandBlock label="macOS Terminal" command={launch.mac.command} />
              <a
                href={launch.mac.download}
                className="mt-3 inline-block rounded-xl border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/10"
              >
                ↓ Download .sh &amp; run instead
              </a>
            </div>
          )}

          <div className="mt-5 flex items-center gap-3">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
            <span className="text-sm text-muted">Waiting for the scan to start…</span>
          </div>
          <button
            onClick={onCancel}
            className="mt-4 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-bad hover:text-bad"
          >
            Cancel
          </button>
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
            <Link
              href="/dashboard"
              className="inline-block rounded-xl border border-border px-5 py-2.5 font-display font-semibold text-foreground hover:border-brand"
            >
              Territory health checks →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
