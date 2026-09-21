import type { OverallStatus } from "@/lib/types";
import { overallMeta, toneClasses } from "@/lib/ui";

export function OverallBadge({ status }: { status: OverallStatus | null }) {
  const meta = overallMeta(status);
  return (
    <div className={`rounded-2xl p-5 ${toneClasses[meta.tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
        Overall result
      </div>
      <div className="mt-1 font-display text-2xl font-bold">{meta.label}</div>
      {meta.blurb ? <p className="mt-2 text-sm opacity-90">{meta.blurb}</p> : null}
    </div>
  );
}
