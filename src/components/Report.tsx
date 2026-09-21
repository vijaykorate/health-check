import type { Check, DiagnosticReport } from "@/lib/types";
import { CATEGORIES } from "@/lib/categories";
import { evidenceForArea } from "@/lib/evidence";
import { toneText, type Tone } from "@/lib/ui";
import { OverallBadge } from "./OverallBadge";
import { MachineInfo } from "./MachineInfo";
import { CheckResultCard } from "./CheckResultCard";
import { ScoreBadge } from "./ScoreBadge";
import { StressTestCard } from "./StressTestCard";

function findCheck(checks: Check[], area: string): Check | undefined {
  return checks.find((c) => c.Area === area);
}

const DOT: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  unknown: "bg-unknown",
};

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: Tone;
}) {
  // Feature 4: a count of 0 stays neutral; a nonzero issue count takes its tone.
  const active = tone && value > 0;
  const colored = active ? toneText[tone] : "text-foreground";
  return (
    <div className="card px-3 py-3 text-center">
      {tone ? (
        <span
          className={`mx-auto mb-1.5 block h-1.5 w-1.5 rounded-full ${active ? DOT[tone] : "bg-border"}`}
        />
      ) : null}
      <div className={`font-display text-2xl font-bold tabular-nums ${colored}`}>{value}</div>
      <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
      {typeof count === "number" ? (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
          {count}
        </span>
      ) : null}
    </div>
  );
}

export function Report({ report }: { report: DiagnosticReport }) {
  const checks = report.Checks ?? [];
  const summary = report.Summary;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <ScoreBadge score={summary?.HealthScore ?? null} />
          <OverallBadge status={summary?.OverallStatus ?? null} />
          {summary ? (
            <>
              <div className="grid grid-cols-4 gap-3">
                <SummaryTile label="Checks" value={summary.Checks} />
                <SummaryTile label="Attention" value={summary.Attention} tone="bad" />
                <SummaryTile label="Watch" value={summary.Watch} tone="warn" />
                <SummaryTile label="Unknown" value={summary.Unknown} tone="unknown" />
              </div>
              <p className="text-sm">
                <span className={toneText.ok}>
                  {Math.max(
                    0,
                    summary.Checks - summary.Attention - summary.Watch - summary.Unknown,
                  )}{" "}
                  passed
                </span>
                <span className="text-muted"> · </span>
                <span className={summary.Attention ? toneText.bad : "text-muted"}>
                  {summary.Attention} need attention
                </span>
                <span className="text-muted"> · </span>
                <span className={summary.Watch ? toneText.warn : "text-muted"}>
                  {summary.Watch} to watch
                </span>
              </p>
            </>
          ) : null}
          {report.Complaint?.Provided ? (
            <div className="rounded-2xl border-l-2 border-accent bg-surface-2 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-accent">
                Reported symptom
                {report.Complaint.Category && report.Complaint.Category !== "None"
                  ? ` · ${report.Complaint.Category}`
                  : ""}
              </div>
              <p className="mt-1 text-sm text-foreground">
                {report.Complaint.Description}
              </p>
            </div>
          ) : null}
        </div>
        <MachineInfo machine={report.Machine ?? {}} />
      </div>

      <div>
        <SectionHeader title="Diagnostic checks" count={checks.length} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.flatMap((cat) =>
            cat.checkAreas.map((area) => {
              const check = findCheck(checks, area);
              if (!check && cat.hideIfAbsent) return null;
              return (
                <CheckResultCard
                  key={`${cat.key}-${area}`}
                  icon={cat.icon}
                  title={area}
                  check={check}
                  evidence={evidenceForArea(report, area)}
                />
              );
            }),
          )}
        </div>
      </div>

      <StressTestCard
        result={
          (report.AutomaticDiagnostics?.StressTest as
            | import("@/lib/types").StressTestResult
            | undefined) ?? null
        }
      />

      {report.DiagnosticErrors && report.DiagnosticErrors.length > 0 ? (
        <details className="rounded-2xl border border-border bg-surface p-4">
          <summary className="cursor-pointer font-display text-sm font-semibold text-foreground">
            Collection notes ({report.DiagnosticErrors.length})
          </summary>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
            {report.DiagnosticErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {report.GeneratedAt ? (
        <p className="text-center text-xs text-muted">
          Generated {new Date(report.GeneratedAt).toLocaleString()} · schema v
          {report.SchemaVersion}
        </p>
      ) : null}
    </div>
  );
}
