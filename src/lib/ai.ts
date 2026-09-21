// Feature 6 (web-knowledge half): Google-Search-grounded lookup via Gemini.
// Best-effort — no key configured, or any failure, degrades to null and never
// blocks the technician or the own-history retrieval.
import type { ExternalReference } from "./types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function aiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

function model(): string {
  // flash-lite / flash variants support the google_search grounding tool.
  return process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

interface GroundedResult {
  text: string;
  sources: ExternalReference[];
}

async function geminiGenerateGrounded(
  prompt: string,
  timeoutMs: number,
): Promise<GroundedResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: "", sources: [] };
  const url = `${API_BASE}/${model()}:generateContent?key=${key}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    },
    timeoutMs,
  );
  const json = await res.json();
  const candidate = json?.candidates?.[0];
  const text: string = candidate?.content?.parts?.[0]?.text ?? "";
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const sources: ExternalReference[] = chunks
    .map((c: { web?: { uri?: string; title?: string } }) => c?.web)
    .filter(Boolean)
    .map((w: { uri?: string; title?: string }) => ({
      title: w.title ?? w.uri ?? "source",
      url: w.uri ?? "",
    }))
    .filter((s: ExternalReference) => s.url);
  return { text, sources };
}

export interface KnowledgeResult {
  summary: string;
  sources: ExternalReference[];
}

/** Look up known issues / fixes for this device + symptom. Returns null if not
 *  configured, nothing found, or on any error. */
export async function searchKnowledgeBase(params: {
  manufacturer: string | null;
  model: string | null;
  category: string | null;
  problem: string | null;
}): Promise<KnowledgeResult | null> {
  if (!aiConfigured()) return null;
  const deviceLabel = [params.manufacturer, params.model].filter(Boolean).join(" ");
  const symptom = params.problem || params.category;
  if (!deviceLabel || !symptom) return null;

  const prompt =
    `Search for known hardware/software issues, service bulletins, or common fixes for:\n` +
    `Device: ${deviceLabel}\nSymptom: ${symptom}\n` +
    `Reply in 2-3 short plain-language sentences a technician could act on. ` +
    `If nothing specific turns up, say so plainly.`;

  try {
    const { text, sources } = await geminiGenerateGrounded(prompt, 15000);
    return text?.trim() ? { summary: text.trim(), sources: sources.slice(0, 5) } : null;
  } catch (err) {
    console.error("[ai] searchKnowledgeBase failed:", err);
    return null;
  }
}
