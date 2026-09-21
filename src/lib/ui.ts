// Shared UI mappings for status → colour tone.
import type { CheckStatus, OverallStatus, Severity } from "./types";

export type Tone = "ok" | "warn" | "bad" | "unknown";

/** Feature 4: severity Low→green / Medium→amber / High·Critical→red. */
export function severityTone(severity: Severity | null): Tone {
  switch (severity) {
    case "Low":
      return "ok";
    case "Medium":
      return "warn";
    case "High":
    case "Critical":
      return "bad";
    default:
      return "unknown";
  }
}

/** Map a per-check status to a colour tone (mirrors the reference statusTone). */
export function checkTone(status: CheckStatus): Tone {
  switch (status) {
    case "Good":
    case "Detected":
      return "ok";
    case "Watch":
      return "warn";
    case "Attention":
      return "bad";
    default:
      return "unknown";
  }
}

/** Tailwind classes for a pill/badge of a given tone. */
export const toneClasses: Record<Tone, string> = {
  ok: "text-ok bg-ok-bg",
  warn: "text-warn bg-warn-bg",
  bad: "text-bad bg-bad-bg",
  unknown: "text-unknown bg-unknown-bg",
};

/** Tailwind text-colour only, for e.g. the progress ring. */
export const toneText: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  unknown: "text-unknown",
};

export interface OverallMeta {
  tone: Tone;
  label: string;
  blurb: string;
}

/** Present the overall roll-up status. */
export function overallMeta(status: OverallStatus | null): OverallMeta {
  switch (status) {
    case "NO_IMMEDIATE_ISSUE_DETECTED":
      return {
        tone: "ok",
        label: "No immediate issue detected",
        blurb: "Automated checks did not surface a hardware or system fault.",
      };
    case "WATCH":
      return {
        tone: "warn",
        label: "Worth watching",
        blurb: "Some readings are within tolerance but trending — keep an eye on them.",
      };
    case "NEEDS_ATTENTION":
      return {
        tone: "bad",
        label: "Needs attention",
        blurb: "One or more checks flagged a likely issue that should be looked at.",
      };
    case "PARTIALLY_ASSESSED":
      return {
        tone: "unknown",
        label: "Partially assessed",
        blurb: "Some checks could not be fully evaluated on this machine.",
      };
    default:
      return { tone: "unknown", label: "Pending", blurb: "" };
  }
}
