// Feature 1: build a copy-paste PowerShell command that launches the scan as a
// separate minimized process. A pasted command was never downloaded, so it
// avoids the browser/SmartScreen warnings a .bat/.exe download can trigger.

/** Single-quoted PS literal: double embedded single quotes (PS's own escape). */
export function psQuote(v: string): string {
  return "'" + String(v ?? "").replace(/'/g, "''") + "'";
}

/**
 * A value destined for the receiving process's argv, embedded inside an outer
 * PS single-quoted literal: strip embedded double quotes (argv rules) and
 * double embedded single quotes (they'd otherwise close the outer literal).
 * Returned wrapped in double quotes so the receiver sees one token.
 */
export function psDoubleQuote(v: string): string {
  return '"' + String(v ?? "").replace(/"/g, "").replace(/'/g, "''") + '"';
}

/**
 * Build the launch command. `scriptPathExpr` is a PS expression (e.g. "$p")
 * that evaluates to the script path — NOT a literal path.
 *
 * -ArgumentList is built as ONE pre-quoted string via `+` concatenation, never
 * an array (array elements with spaces aren't reliably preserved by
 * Start-Process). A flag is omitted entirely when empty rather than passed as
 * "" (-ArgumentList rejects a null/empty element). elevated=true wraps in
 * try/Verb-RunAs/catch, falling back to a normal launch if UAC is declined or
 * the account isn't admin. Both paths spawn a separate minimized window.
 */
export function buildLaunchCommand(
  scriptPathExpr: string,
  sessionId: string,
  url: string,
  complaint: string,
  category: string,
  stressTest: boolean,
  elevated: boolean,
): string {
  const psArgs =
    "'-NoProfile -ExecutionPolicy " +
    psDoubleQuote("Bypass") +
    " -File ' + " +
    scriptPathExpr +
    (sessionId ? " + ' -SessionId " + psDoubleQuote(sessionId) + "'" : "") +
    (url ? " + ' -BackendUrl " + psDoubleQuote(url) + "'" : "") +
    (complaint ? " + ' -Complaint " + psDoubleQuote(complaint) + "'" : "") +
    (category ? " + ' -Category " + psDoubleQuote(category) + "'" : "") +
    (stressTest ? " + ' -StressTest'" : "");

  if (!elevated) {
    return `$pockitArgs = ${psArgs}; Start-Process powershell.exe -WindowStyle Minimized -ArgumentList $pockitArgs`;
  }
  return (
    `$pockitArgs = ${psArgs}; ` +
    `try { Start-Process powershell.exe -Verb RunAs -WindowStyle Minimized -ArgumentList $pockitArgs -ErrorAction Stop } ` +
    `catch { Start-Process powershell.exe -WindowStyle Minimized -ArgumentList $pockitArgs }`
  );
}

/** POSIX single-quote a value for a shell one-liner. */
export function shQuote(v: string): string {
  return "'" + String(v ?? "").replace(/'/g, "'\\''") + "'";
}

/**
 * macOS Terminal one-liner: curl the engine, make it executable, run it with
 * the kebab-case args the .sh expects.
 */
export function buildMacCommand(params: {
  backendUrl: string;
  sessionId: string;
  complaint: string;
  category: string;
}): string {
  const { backendUrl, sessionId, complaint, category } = params;
  const scriptUrl = `${backendUrl}/api/launcher/sh`;
  const args =
    `--session-id ${shQuote(sessionId)} --backend-url ${shQuote(backendUrl)}` +
    (complaint ? ` --complaint ${shQuote(complaint)}` : "") +
    (category ? ` --category ${shQuote(category)}` : "");
  return (
    `curl -fsSL ${shQuote(scriptUrl)} -o /tmp/pockit-mac-scan.sh && ` +
    `chmod +x /tmp/pockit-mac-scan.sh && /tmp/pockit-mac-scan.sh ${args}`
  );
}

/**
 * Full pasteable one-liner: fetch the engine from this server to a temp file,
 * then launch it. `backendUrl` is where the script both downloads from and
 * posts results back to — derive it from the request host so a scan on another
 * LAN machine reports back to a reachable address.
 */
export function buildPasteCommand(params: {
  backendUrl: string;
  sessionId: string;
  complaint: string;
  category: string;
  stressTest: boolean;
  elevated: boolean;
}): string {
  const { backendUrl, sessionId, complaint, category, stressTest, elevated } = params;
  const scriptUrl = `${backendUrl}/api/launcher/ps1`;
  const download =
    `$p = "$env:TEMP\\pockit-${sessionId}.ps1"; ` +
    `Invoke-WebRequest -Uri ${psDoubleQuote(scriptUrl)} -OutFile $p; `;
  return (
    download +
    buildLaunchCommand("$p", sessionId, backendUrl, complaint, category, stressTest, elevated)
  );
}
