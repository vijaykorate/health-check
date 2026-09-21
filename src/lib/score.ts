// Health score (feature 2): one 0–100 number derived from the checks.
import type { Check } from "./types";
import type { Tone } from "./ui";

/**
 * Compute a single 0–100 health score from the per-check statuses.
 * Attention is the heaviest penalty; Unknown is light (a check we couldn't
 * fully evaluate shouldn't tank the score like a real fault).
 */
export function computeHealthScore(checks: Check[] | undefined): number | null {
  if (!Array.isArray(checks) || !checks.length) return null;
  let score = 100;
  for (const c of checks) {
    if (c.Status === "Attention") score -= 20;
    else if (c.Status === "Watch") score -= 8;
    else if (c.Status === "Unknown") score -= 2;
  }
  return Math.max(0, Math.min(100, score));
}

/** Band a score into a colour tone: ≥85 green / 65–84 amber / <65 red. */
export function scoreTone(score: number | null): Tone {
  if (score === null) return "unknown";
  if (score >= 85) return "ok";
  if (score >= 65) return "warn";
  return "bad";
}

/** Short plain-language label for a score band. */
export function scoreLabel(score: number | null): string {
  if (score === null) return "Not scored";
  if (score >= 85) return "Healthy";
  if (score >= 65) return "Fair";
  return "Poor";
}
