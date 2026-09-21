import type { StressTestResult } from "@/lib/types";
import { toneClasses, type Tone } from "@/lib/ui";

// Map the engine's stress-test Finding to a tone.
function findingTone(r: StressTestResult): Tone {
  if (r.Finding === "PASSED") return "ok";
  if (r.Finding === "FAILED") return "bad";
  if (r.Finding === "PARTIAL" || r.Finding === "SKIPPED") return "warn";
  return "unknown";
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1.5 last:border-b-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-right text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

export function StressTestCard({ result }: { result: StressTestResult | null }) {
  if (!result || !result.Requested) return null;
  const tone = findingTone(result);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-foreground">
          ⚙️ Extended stability test
        </h3>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${toneClasses[tone]}`}
        >
          {result.Finding}
        </span>
      </div>

      <p className="mt-2 text-sm text-foreground">{result.Explanation}</p>
      {result.CustomerMeaning ? (
        <p className="mt-1 text-xs text-muted">{result.CustomerMeaning}</p>
      ) : null}

      <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
        <Line label="Duration" value={`${result.DurationSeconds}s`} />
        <Line
          label="CPU load"
          value={
            result.CpuCompleted
              ? `Completed (${result.CpuCoresLoaded ?? "?"} cores)`
              : `Incomplete (${result.CpuCoresLoaded ?? "?"} cores)`
          }
        />
        <Line
          label="Disk write/verify"
          value={
            result.DiskSkippedReason
              ? "Skipped"
              : result.DiskCompleted
                ? `Verified ${result.DiskWriteVerifiedMB ?? "?"} MB`
                : "Failed verify"
          }
        />
        <Line label="Confidence" value={`${result.Confidence}%`} />
      </div>

      {result.DiskSkippedReason ? (
        <p className="mt-2 text-xs text-warn">{result.DiskSkippedReason}</p>
      ) : null}
      {result.Errors && result.Errors.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-bad">
          {result.Errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
