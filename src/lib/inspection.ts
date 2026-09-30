// Physical inspection checklist (ported structure from the reference webapp).
// Each item is keyed "Section|Label" in the stored Inspection map.

export interface InspectionSection {
  section: string;
  items: string[];
}

// Section names AND item labels MUST match the backend taxonomy EXACTLY
// (pockit-backend-pre-prod/services/HealthCheck/inspectionItems.js) — the report
// keys each row on "Section|Label". Each item is phrased as a clear
// "issue present?" question: Yes = finding present (stored "issue", shows a
// remark), No = fine (stored "ok"). There is no N/T option — items the technician
// doesn't answer are simply omitted from the report (never shown as "Not Tested").
export const INSPECTION_SECTIONS: InspectionSection[] = [
  {
    section: "Exterior",
    items: ["Physical damage", "Scratches / scuffs", "Cracked casing or hinges", "Liquid damage signs"],
  },
  {
    section: "Display",
    items: ["Screen cracks / damage", "Dead or stuck pixels", "Flickering", "Brightness problems"],
  },
  {
    section: "Keyboard & Touchpad",
    items: ["Keys not working", "Sticky or missing keys", "Touchpad not working", "Gestures not working"],
  },
  {
    section: "Ports",
    items: ["USB / USB-C faulty", "HDMI faulty", "Audio jack faulty", "SD card slot faulty"],
  },
];

export function inspectionKey(section: string, label: string): string {
  return `${section}|${label}`;
}
