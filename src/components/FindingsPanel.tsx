"use client";

import { useState } from "react";
import type {
  ExternalReference,
  Severity,
  SimilarCase,
  TechnicianFindings,
} from "@/lib/types";
import { FINDING_OPTIONS, SEVERITIES, QUICK_RECOMMENDATIONS } from "@/lib/findings-data";
import { severityTone, toneClasses } from "@/lib/ui";

const OUTCOME_LABEL: Record<string, string> = {
  possible_recurrence: "May not have fully resolved",
  no_repeat_visit: "No repeat visit on record",
  unknown: "Outcome unknown",
};
const OUTCOME_TONE: Record<string, "ok" | "warn" | "unknown"> = {
  possible_recurrence: "warn",
  no_repeat_visit: "ok",
  unknown: "unknown",
};

interface AiDraft {
  similarCases: SimilarCase[];
  external: { summary: string; sources: ExternalReference[] } | null;
  aiConfigured: boolean;
}

export function FindingsPanel({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: TechnicianFindings;
}) {
  const [primaryFinding, setPrimaryFinding] = useState(initial.primaryFinding ?? "");
  const [severity, setSeverity] = useState<Severity | "">(initial.severity ?? "");
  const [diagnosis, setDiagnosis] = useState(initial.diagnosis ?? "");
  const [recommendation, setRecommendation] = useState(initial.recommendation ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [ai, setAi] = useState<AiDraft | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/diagnostics/${sessionId}/findings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryFinding, severity, diagnosis, recommendation }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      }
    } finally {
      setSaving(false);
    }
  }

  async function draftWithAi() {
    setAiLoading(true);
    try {
      const res = await fetch(`/api/diagnostics/${sessionId}/ai-draft`, { method: "POST" });
      if (res.ok) setAi((await res.json()) as AiDraft);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-foreground">
          Technician findings
        </h3>
        <button
          onClick={draftWithAi}
          disabled={aiLoading}
          className="rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10 disabled:opacity-60"
        >
          {aiLoading ? "Drafting…" : "Draft with AI"}
        </button>
      </div>

      {/* Primary finding */}
      <label className="mt-4 block text-xs font-semibold text-muted">Primary finding</label>
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

      {/* Severity — feature 4 colours each level */}
      <label className="mt-4 block text-xs font-semibold text-muted">Severity</label>
      <div className="mt-1 flex flex-wrap gap-2">
        {SEVERITIES.map((s) => {
          const active = severity === s;
          const tone = severityTone(s);
          return (
            <button
              key={s}
              onClick={() => setSeverity(active ? "" : s)}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${
                active ? toneClasses[tone] : "border border-border text-muted"
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>

      {/* Diagnosis */}
      <label className="mt-4 block text-xs font-semibold text-muted">Diagnosis</label>
      <textarea
        value={diagnosis}
        onChange={(e) => setDiagnosis(e.target.value)}
        rows={2}
        className="mt-1 w-full resize-none rounded-lg border border-border bg-surface p-2 text-sm text-foreground"
      />

      {/* Recommendation + quick chips */}
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

      <button
        onClick={save}
        disabled={saving}
        className="mt-4 rounded-xl bg-brand px-5 py-2.5 font-display font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save findings"}
      </button>

      {/* ── AI: two clearly separate sources ── */}
      {ai ? (
        <div className="mt-6 space-y-4">
          {/* (a) Own history */}
          <div className="rounded-xl border border-brand/40 bg-brand/5 p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-brand">
              From your own history
            </div>
            {ai.similarCases.length === 0 ? (
              <p className="mt-1 text-sm text-muted">
                No similar prior cases for this machine yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {ai.similarCases.map((c) => (
                  <li key={c.id} className="rounded-lg bg-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {c.diagnosis ?? c.recommendation}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneClasses[OUTCOME_TONE[c.outcome]]}`}
                      >
                        {OUTCOME_LABEL[c.outcome]}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {new Date(c.date).toLocaleDateString()} · {c.complaint || c.category || "—"}
                      {c.recommendation ? ` · ${c.recommendation}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* (b) External reference */}
          <div className="rounded-xl border border-border bg-surface-2 p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-muted">
              External reference{" "}
              <span className="font-normal normal-case">(web, unverified)</span>
            </div>
            {!ai.aiConfigured ? (
              <p className="mt-1 text-sm text-muted">
                Web knowledge not configured (set <code>GEMINI_API_KEY</code> to enable).
              </p>
            ) : !ai.external ? (
              <p className="mt-1 text-sm text-muted">
                No specific external references found.
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-foreground">{ai.external.summary}</p>
                {ai.external.sources.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {ai.external.sources.map((s, i) => (
                      <li key={i}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand hover:underline"
                        >
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
