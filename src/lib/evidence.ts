// Maps a check Area to its slice of report.AutomaticDiagnostics (the raw
// evidence the engine collected). Shapes vary per area and are intentionally
// kept loose — the UI renders whatever is there as formatted JSON.
import type { DiagnosticReport } from "./types";

type Diag = Record<string, unknown>;

function get(diag: Diag, key: string): unknown {
  return diag[key];
}

/** Return the raw-evidence object for a given check Area, or undefined. */
export function evidenceForArea(
  report: DiagnosticReport,
  area: string,
): unknown {
  const diag = (report.AutomaticDiagnostics ?? {}) as Diag;
  const components = (get(diag, "Components") ?? {}) as Diag;

  switch (area) {
    case "Performance":
      return get(diag, "Performance");
    case "Startup Programs":
      return get(diag, "Startup");
    case "Storage":
      return get(diag, "Storage");
    case "Battery": {
      const battery: Diag = {};
      const baseline = get(diag, "BatteryBaseline");
      const power = get(diag, "PowerBaseline");
      const dell = get(diag, "DellPower");
      const investigation = get(diag, "ComplaintInvestigation");
      if (baseline !== undefined) battery.BatteryBaseline = baseline;
      if (power !== undefined) battery.PowerBaseline = power;
      if (dell !== undefined) battery.DellPower = dell;
      // Only attach the complaint block when it's actually the battery test.
      if (
        investigation &&
        typeof investigation === "object" &&
        (investigation as Diag).Category === "Battery"
      ) {
        battery.ComplaintInvestigation = investigation;
      }
      return Object.keys(battery).length ? battery : undefined;
    }
    case "Drivers":
      return get(diag, "Drivers");
    case "Network":
      return get(diag, "Network");
    case "Display":
      return get(components, "GPU");
    case "Monitor":
      return get(components, "Monitors");
    case "Touch Input":
      return get(components, "TouchInput");
    case "Camera":
      return get(components, "CameraCandidates");
    case "Audio":
      return get(components, "Audio");
    case "Keyboard":
      return get(components, "Keyboard");
    case "Touchpad":
      return get(components, "Pointing");
    case "USB":
      return get(components, "USB");
    default:
      return undefined;
  }
}

/** True when there is meaningful evidence worth showing an expander for. */
export function hasEvidence(evidence: unknown): boolean {
  if (evidence === undefined || evidence === null) return false;
  if (Array.isArray(evidence)) return evidence.length > 0;
  if (typeof evidence === "object") return Object.keys(evidence).length > 0;
  return true;
}
