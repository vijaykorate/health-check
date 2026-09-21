"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface ManualResult {
  id: string;
  url: string;
  launchCommand: string;
  launchCommandElevated: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard may be blocked; ignore */
        }
      }}
      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <CopyButton text={command} />
      </div>
      <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-foreground">
        {command}
      </pre>
    </div>
  );
}

export function StartForm() {
  const router = useRouter();
  const [complaint, setComplaint] = useState("");
  const [stressTest, setStressTest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<ManualResult | null>(null);

  async function post(mode: "auto" | "manual") {
    const res = await fetch("/api/diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ complaint, stressTest, mode }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Request failed (${res.status})`);
    }
    return res.json();
  }

  async function start() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = (await post("auto")) as { url: string };
      router.push(data.url);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  async function generateManual() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = (await post("manual")) as ManualResult;
      setManual(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full">
      <label htmlFor="complaint" className="block text-sm font-medium text-foreground">
        Describe the problem <span className="text-muted">(optional)</span>
      </label>
      <p className="mt-1 text-xs text-muted">
        Mentioning a symptom (e.g. &ldquo;battery drains fast&rdquo;) runs a
        deeper, targeted investigation for that area.
      </p>
      <textarea
        id="complaint"
        value={complaint}
        onChange={(e) => setComplaint(e.target.value)}
        rows={3}
        placeholder="e.g. Laptop is slow and the battery doesn't seem to charge…"
        className="mt-2 w-full resize-none rounded-xl border border-border bg-surface p-3 text-sm text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
      />

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3">
        <input
          type="checkbox"
          checked={stressTest}
          onChange={(e) => setStressTest(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
        />
        <span>
          <span className="text-sm font-medium text-foreground">
            Run extended stability test
          </span>
          <span className="ml-1 text-xs text-muted">(~2–3 min)</span>
          <span className="mt-0.5 block text-xs text-muted">
            Actively loads every CPU core plus a disk write/verify cycle — catches
            faults a passive scan can miss.
          </span>
        </span>
      </label>

      {error ? (
        <p className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>
      ) : null}

      <button
        onClick={start}
        disabled={submitting}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 font-display font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Working…" : "Run Health Check"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        Runs a silent diagnostic on this Windows machine. Takes ~10–70 seconds.
      </p>

      <details className="mt-4 border-t border-border pt-4">
        <summary className="cursor-pointer text-sm font-medium text-brand">
          Run on another Windows PC, or with admin rights
        </summary>
        <p className="mt-2 text-xs text-muted">
          Generates a command to paste into an open PowerShell window — nothing is
          downloaded, so no SmartScreen/browser warning. Admin rights unlock SMART
          storage counters and some battery data.
        </p>
        {!manual ? (
          <button
            onClick={generateManual}
            disabled={submitting}
            className="mt-3 rounded-xl border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/10 disabled:opacity-60"
          >
            Generate paste command
          </button>
        ) : (
          <div>
            <CommandBlock label="Standard" command={manual.launchCommand} />
            <CommandBlock label="With admin rights (UAC prompt)" command={manual.launchCommandElevated} />
            <Link
              href={manual.url}
              className="mt-3 inline-block rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
            >
              Open live view →
            </Link>
          </div>
        )}
      </details>
    </div>
  );
}
