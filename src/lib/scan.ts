// Spawns the bundled diagnostic engine against the local Windows machine.
//
// The engine runs silently and POSTs its progress + final report back to this
// same server over HTTP (see src/app/api/sessions/[id]/*). We never read its
// stdout — results arrive via those callbacks.

import { spawn } from "node:child_process";
import path from "node:path";

/** Absolute path to the bundled PowerShell engine (override with POCKIT_PS1). */
function scriptPath(): string {
  return (
    process.env.POCKIT_PS1 ??
    path.join(process.cwd(), "scripts", "Pockit-PC-Diagnostic-V1.0.ps1")
  );
}

/** Base URL the engine posts progress/complete/fail back to. */
function backendUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
}

/**
 * Launch the scan for a session. Fire-and-forget: the engine reports back over
 * HTTP. `category` may be "" — the engine then self-classifies the complaint.
 * `stressTest` adds the opt-in extended stability test (feature 3).
 *
 * Not detached, windowsHide, stdio ignored — mirrors the reference launcher,
 * which documents that `detached:true` gets the child killed on some Windows
 * job-object setups.
 */
export function startScan(
  id: string,
  complaint: string,
  category: string,
  stressTest = false,
): void {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath(),
    "-SessionId",
    id,
    "-BackendUrl",
    backendUrl(),
    "-Complaint",
    complaint ?? "",
    "-Category",
    category ?? "",
  ];
  if (stressTest) args.push("-StressTest");

  const child = spawn("powershell.exe", args, {
    windowsHide: true,
    stdio: "ignore",
  });

  // If the process itself can't launch (e.g. powershell.exe missing), surface
  // it — the engine's own failures come back via /api/sessions/[id]/fail.
  child.on("error", (err) => {
    console.error(`[scan ${id}] failed to spawn engine:`, err);
  });

  child.unref();
}
