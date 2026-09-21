// Physical inspection checklist (ported structure from the reference webapp).
// Each item is keyed "Section|Label" in the stored Inspection map.

export interface InspectionSection {
  section: string;
  items: string[];
}

export const INSPECTION_SECTIONS: InspectionSection[] = [
  {
    section: "Exterior",
    items: ["Chassis / body", "Hinges", "Screws present", "Rubber feet", "Physical damage"],
  },
  {
    section: "Display",
    items: ["Panel (no cracks)", "Backlight even", "Dead / stuck pixels", "Bezel & webcam"],
  },
  {
    section: "Keyboard & Touchpad",
    items: ["All keys present", "Keys responsive", "Touchpad click", "Palm rest"],
  },
  {
    section: "Ports",
    items: ["USB ports", "HDMI / video", "Audio jack", "Charging port"],
  },
];

export function inspectionKey(section: string, label: string): string {
  return `${section}|${label}`;
}
