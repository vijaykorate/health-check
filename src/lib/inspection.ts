// Physical inspection checklist (ported structure from the reference webapp).
// Each item is keyed "Section|Label" in the stored Inspection map.

export interface InspectionSection {
  section: string;
  items: string[];
}

// Section names AND item labels must match the backend report's Physical
// Inspection taxonomy EXACTLY — the report keys each row on "Section|Label", so
// any mismatch renders as "Not Tested" (only "Touchpad click" used to line up).
// Item labels below are transcribed from the delivered report.
export const INSPECTION_SECTIONS: InspectionSection[] = [
  {
    section: "Exterior",
    items: ["No visible damage", "Minor scratches", "Cracked casing / hinges", "Liquid damage suspected"],
  },
  {
    section: "Display",
    items: ["No visible issue", "Dead pixels", "Flickering", "Brightness issue"],
  },
  {
    section: "Keyboard & Touchpad",
    items: ["Keys working", "Sticky / missing keys", "Touchpad click", "Gestures"],
  },
  {
    section: "Ports",
    items: ["USB / USB-C", "HDMI"],
  },
];

export function inspectionKey(section: string, label: string): string {
  return `${section}|${label}`;
}
