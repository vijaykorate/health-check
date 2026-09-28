import type { Check, Inspection } from "./types";

const API_KEY = process.env.GEMINI_API_KEY || "";
const DRAFT_MODEL = process.env.GEMINI_DRAFT_MODEL || "gemini-flash-lite-latest";
// Fallback when the primary model is overloaded: gemini-flash-lite-latest has
// been returning sustained 503 ("high demand") that even retries can't ride out,
// while gemini-flash-latest stays available. Tried after the primary's retries.
const DRAFT_FALLBACK_MODEL = process.env.GEMINI_DRAFT_FALLBACK_MODEL || "gemini-flash-latest";
const THINKING_CONFIG = { thinkingLevel: "low" };
const DRAFT_TIMEOUT_MS = 30000;

// Primary model, then fallback — de-duplicated in case they're configured the same.
function modelChain(primary: string): string[] {
  return [primary, DRAFT_FALLBACK_MODEL].filter((m, i, a) => m && a.indexOf(m) === i);
}

export interface AiDraftResult {
  finding?: string;
  severity?: string;
  diagnosis?: string;
  recommendation?: string;
}

const SEVERITY_OPTIONS = ["Low", "Medium", "High", "Critical"] as const;

/** Normalise the model's severity word to one of the canonical options. */
function normaliseSeverity(raw?: string): string | undefined {
  if (!raw) return undefined;
  const hit = SEVERITY_OPTIONS.find((s) => s.toLowerCase() === raw.trim().toLowerCase());
  return hit;
}
export interface AiWebKnowledge {
  summary: string;
  sources: { title?: string; url?: string }[];
}

export function isConfigured(): boolean {
  return Boolean(API_KEY);
}

export async function draftDiagnosis({
  problem,
  checks,
  inspection,
}: {
  problem?: string | null;
  checks?: Check[] | null;
  inspection?: Inspection | null;
}): Promise<AiDraftResult | null> {
  if (!isConfigured()) return null;
  try {
    const checksSummary = (checks || [])
      .map((c) => `- ${c.Area}: ${c.Status} (${c.Value})`)
      .join("\n");
    const inspectionSummary =
      Object.entries(inspection || {})
        .filter(([, v]) => v === "issue")
        .map(([k]) => k.split("|")[1])
        .join(", ") || "none noted";

    const prompt = `You are drafting a starting point for a PC repair technician to review and edit - not a final answer.
Customer complaint: ${problem || "none provided"}
Automatic diagnostic checks:
${checksSummary || "none available"}
Physical inspection issues noted: ${inspectionSummary}

Reply with exactly four lines in this format, no extra commentary:
FINDING: <one of Battery issue, Charger/adapter issue, Storage issue, RAM/performance issue, Driver/software issue, Display issue, Keyboard issue, Touchpad issue, Camera issue, Audio issue, Network issue, Physical damage, No fault found, Further diagnosis required>
SEVERITY: <one of Low, Medium, High, Critical>
DIAGNOSIS: <one or two plain-language sentences on what's actually wrong>
RECOMMENDATION: <one or two plain-language sentences on the next action for the customer>`;

    const text = await geminiGenerate(prompt, 0.3, DRAFT_MODEL, DRAFT_TIMEOUT_MS);
    const finding = (text.match(/FINDING:\s*(.+)/i) || [])[1]?.trim();
    const severity = normaliseSeverity((text.match(/SEVERITY:\s*(.+)/i) || [])[1]);
    const diagnosis = (text.match(/DIAGNOSIS:\s*(.+)/i) || [])[1]?.trim();
    const recommendation = (text.match(/RECOMMENDATION:\s*(.+)/i) || [])[1]?.trim();
    if (!diagnosis && !recommendation) return null;
    return { finding, severity, diagnosis, recommendation };
  } catch (err) {
    console.error("[hc-ai] draftDiagnosis failed:", (err as Error)?.message || err);
    return null;
  }
}

export async function searchKnowledgeBase({
  manufacturer,
  model,
  category,
  problem,
}: {
  manufacturer?: string | null;
  model?: string | null;
  category?: string | null;
  problem?: string | null;
}): Promise<AiWebKnowledge | null> {
  if (!isConfigured()) return null;
  const deviceLabel = [manufacturer, model].filter(Boolean).join(" ");
  const symptom = problem || category;
  if (!deviceLabel || !symptom) return null;
  try {
    const prompt = `Search for known hardware/software issues, service bulletins, or common fixes for:
Device: ${deviceLabel}
Symptom: ${symptom}
Reply in 2-3 short plain-language sentences a technician could act on. If nothing specific turns up, say so plainly.`;
    const { text, sources } = await geminiGenerateGrounded(prompt, DRAFT_MODEL, DRAFT_TIMEOUT_MS);
    if (!text || !text.trim()) return null;
    return { summary: text.trim(), sources: sources.slice(0, 5) };
  } catch (err) {
    console.error("[hc-ai] searchKnowledgeBase failed:", (err as Error)?.message || err);
    return null;
  }
}

async function geminiGenerate(
  prompt: string,
  temperature: number,
  model: string,
  timeoutMs: number,
): Promise<string> {
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, thinkingConfig: THINKING_CONFIG },
    }),
  };
  let lastRes: Response | null = null;
  for (const m of modelChain(model)) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${API_KEY}`;
    const res = await geminiFetch(url, options, timeoutMs);
    if (res.ok) {
      const json = await res.json();
      return json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }
    lastRes = res;
  }
  throw new Error(`Gemini HTTP ${lastRes?.status}: ${lastRes ? await lastRes.text() : "no response"}`);
}

async function geminiGenerateGrounded(
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<{ text: string; sources: { title?: string; url?: string }[] }> {
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { thinkingConfig: THINKING_CONFIG },
    }),
  };
  let json: Record<string, unknown> | null = null;
  let lastRes: Response | null = null;
  for (const m of modelChain(model)) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${API_KEY}`;
    const res = await geminiFetch(url, options, timeoutMs);
    if (res.ok) {
      json = await res.json();
      break;
    }
    lastRes = res;
  }
  if (!json) throw new Error(`Gemini HTTP ${lastRes?.status}: ${lastRes ? await lastRes.text() : "no response"}`);
  const candidate = (json as { candidates?: unknown[] })?.candidates?.[0] as
    | { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { title?: string; uri?: string } }[] } }
    | undefined;
  const text = candidate?.content?.parts?.[0]?.text || "";
  const sources = (candidate?.groundingMetadata?.groundingChunks || [])
    .map((c: { web?: { title?: string; uri?: string } }) => c?.web)
    .filter(Boolean)
    .map((w) => ({ title: w!.title, url: w!.uri }));
  return { text, sources };
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Gemini's shared "-latest" models return 503 ("model experiencing high demand")
// and 429 (rate limit) under load — transient conditions that a short retry rides
// out. Without this, a single 503 surfaces to the technician as "AI couldn't draft".
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_BACKOFF_MS = [700, 1500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// fetchWithTimeout + retry on transient upstream failures (retryable HTTP status
// or a network/abort error). Returns the final Response (which may still be
// non-ok — the caller decides how to surface that).
async function geminiFetch(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === RETRY_BACKOFF_MS.length) {
        return res;
      }
    } catch (err) {
      lastErr = err;
      if (attempt === RETRY_BACKOFF_MS.length) throw err;
    }
    await sleep(RETRY_BACKOFF_MS[attempt]);
  }
  // Unreachable (loop returns/throws on the last attempt), but satisfies the type.
  throw lastErr ?? new Error("Gemini request failed");
}
