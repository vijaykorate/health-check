import type { Check } from "@/lib/types";
import { hasEvidence } from "@/lib/evidence";
import { StatusPill } from "./StatusPill";

export function CheckResultCard({
  icon,
  title,
  check,
  evidence,
}: {
  icon: string;
  title: string;
  check?: Check;
  evidence?: unknown;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl" aria-hidden>
            {icon}
          </span>
          <span className="font-display font-semibold text-foreground">{title}</span>
        </div>
        {check ? <StatusPill status={check.Status} /> : (
          <span className="rounded-full bg-unknown-bg px-2.5 py-0.5 text-xs font-semibold text-unknown">
            Not reported
          </span>
        )}
      </div>

      {check ? (
        <>
          <p className="mt-2 text-sm font-medium text-foreground">{check.Value}</p>
          {check.Details ? (
            <p className="mt-1 text-xs leading-relaxed text-muted">{check.Details}</p>
          ) : null}
          {typeof check.Confidence === "number" ? (
            <div className="mt-3">
              <div className="flex justify-between text-[11px] text-muted">
                <span>Confidence</span>
                <span>{check.Confidence}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.max(0, Math.min(100, check.Confidence))}%` }}
                />
              </div>
            </div>
          ) : null}

          {hasEvidence(evidence) ? (
            <details className="group mt-3 border-t border-border pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-brand">
                <span className="transition-transform group-open:rotate-90" aria-hidden>
                  ▸
                </span>
                Raw evidence
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                {JSON.stringify(evidence, null, 2)}
              </pre>
            </details>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">
          This check was not part of this scan.
        </p>
      )}
    </div>
  );
}
