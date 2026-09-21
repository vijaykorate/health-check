// Display metadata for the diagnostic categories shown in the UI.
//
// Adapted from the reference webapp's appData.js. `checkAreas` maps a card to
// one or more entries in report.Checks[] (by their `Area`). `at` is the approx
// progress percent at which the engine reaches that stage — used to show
// Queued → Running → Done during a live scan.

export interface CategoryMeta {
  key: string;
  name: string;
  icon: string;
  detail: string;
  checkAreas: string[];
  at: number;
  /** Hide the card if none of its checkAreas are present (e.g. no touchscreen). */
  hideIfAbsent?: boolean;
}

export const CATEGORIES: CategoryMeta[] = [
  { key: "system", name: "System", icon: "🖥️", detail: "CPU · RAM · Windows · BIOS", checkAreas: ["Performance"], at: 8 },
  { key: "startup", name: "Startup Programs", icon: "🚀", detail: "Apps launching at sign-in", checkAreas: ["Startup Programs"], at: 20 },
  { key: "storage", name: "Storage", icon: "💾", detail: "SSD/HDD health · capacity · free space", checkAreas: ["Storage"], at: 20 },
  { key: "battery", name: "Battery & Power", icon: "🔋", detail: "Health · charging · cycles", checkAreas: ["Battery"], at: 34 },
  { key: "drivers", name: "Drivers", icon: "🧩", detail: "Device Manager · unsigned drivers", checkAreas: ["Drivers"], at: 46 },
  { key: "network", name: "Network", icon: "🌐", detail: "Wi-Fi · adapter · connectivity", checkAreas: ["Network"], at: 58 },
  { key: "display", name: "Display", icon: "🖼️", detail: "GPU · panel detection", checkAreas: ["Display"], at: 58 },
  { key: "monitor", name: "Monitor", icon: "📺", detail: "Is a display actually connected", checkAreas: ["Monitor"], at: 58 },
  { key: "camera", name: "Camera", icon: "📷", detail: "Device presence", checkAreas: ["Camera"], at: 58 },
  { key: "audio", name: "Audio", icon: "🔊", detail: "Playback device presence", checkAreas: ["Audio"], at: 58 },
  { key: "input", name: "Keyboard & Touchpad", icon: "⌨️", detail: "Device enumeration", checkAreas: ["Keyboard", "Touchpad"], at: 58 },
  { key: "touch", name: "Touch Input", icon: "👆", detail: "Touchscreen/digitizer presence", checkAreas: ["Touch Input"], at: 58, hideIfAbsent: true },
  { key: "usb", name: "USB", icon: "🔌", detail: "Port / device enumeration", checkAreas: ["USB"], at: 58 },
];

/** Live phase of a category card while a scan is in flight. */
export type CategoryPhase = "queued" | "running" | "done";

/** Derive queued/running/done for a card from the current scan percent. */
export function categoryPhase(cat: CategoryMeta, percent: number, running: boolean): CategoryPhase {
  if (!running) return "done";
  // A stage is "done" once progress has moved comfortably past where it starts.
  if (percent >= cat.at + 12) return "done";
  if (percent >= cat.at) return "running";
  return "queued";
}
