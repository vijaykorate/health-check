// Option lists for the technician findings form (ported from the reference
// webapp's appData.js).
import type { Severity } from "./types";

export const FINDING_OPTIONS = [
  "Battery issue",
  "Charger/adapter issue",
  "Storage issue",
  "RAM/performance issue",
  "Driver/software issue",
  "Display issue",
  "Keyboard issue",
  "Touchpad issue",
  "Camera issue",
  "Audio issue",
  "Network issue",
  "Physical damage",
  "No fault found",
  "Further diagnosis required",
];

export const SEVERITIES: Severity[] = ["Low", "Medium", "High", "Critical"];

export const QUICK_RECOMMENDATIONS = [
  "No Action Required",
  "Monitor",
  "Software Service",
  "Hardware Service",
  "Part Replacement",
  "Further Diagnosis Required",
  "Customer Approval Required",
];
