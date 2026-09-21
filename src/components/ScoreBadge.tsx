import { scoreLabel, scoreTone } from "@/lib/score";
import { toneClasses } from "@/lib/ui";

/** Big 0–100 health score (feature 2), banded green/amber/red (feature 4). */
export function ScoreBadge({ score }: { score: number | null }) {
  const tone = scoreTone(score);
  return (
    <div className={`flex items-center gap-4 rounded-2xl p-5 ${toneClasses[tone]}`}>
      <div className="flex items-baseline">
        <span className="font-display text-5xl font-bold tabular-nums">
          {score === null ? "—" : score}
        </span>
        <span className="ml-1 text-lg font-semibold opacity-70">/100</span>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
          Health score
        </div>
        <div className="font-display text-lg font-bold">{scoreLabel(score)}</div>
      </div>
    </div>
  );
}
