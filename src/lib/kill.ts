// Feature 5: stop the real scan process for a session.
import { spawn } from "node:child_process";
import { psQuote } from "./launch";

/**
 * Kill the scan by finding the powershell process whose command line contains
 * the session id — NOT by a tracked handle. An elevated scan's launcher
 * relaunches itself elevated and exits almost immediately, so a tracked handle
 * is stale and the real elevated process has no parent-child link to it.
 * Only reaches a process on the same machine as this backend; a scan on a
 * customer's own machine via a manual launcher is cancel-in-database-only.
 */
export function killScanProcess(sessionId: string): void {
  const psScript =
    `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ` +
    `Where-Object { $_.CommandLine -and $_.CommandLine.Contains(${psQuote(sessionId)}) } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", psScript], {
      windowsHide: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Best-effort — the DB state is already updated by the caller.
  }
}
