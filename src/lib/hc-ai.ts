import type { Check, Inspection } from "./types";

const API_KEY = process.env.GEMINI_API_KEY || "";
const DRAFT_MODEL = process.env.GEMINI_DRAFT_MODEL || "gemini-flash-lite-latest";
const THINKING_CONFIG = { thinkingLevel: "low" };
const DRAFT_TIMEOUT_MS = 30000;

export interface AiDraftResult {
  finding?: string;
  diagnosis?: string;
  recommendation?: string;
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

Reply with exactly three lines in this format, no extra commentary:
FINDING: <one of Battery issue, Charger/adapter issue, Storage issue, RAM/performance issue, Driver/software issue, Display issue, Keyboard issue, Touchpad issue, Camera issue, Audio issue, Network issue, Physical damage, No fault found, Further diagnosis required>
DIAGNOSIS: <one or two plain-language sentences on what's actually wrong>
RECOMMENDATION: <one or two plain-language sentences on the next action for the customer>`;

    const text = await geminiGenerate(prompt, 0.3, DRAFT_MODEL, DRAFT_TIMEOUT_MS);
    const finding = (text.match(/FINDING:\s*(.+)/i) || [])[1]?.trim();
    const diagnosis = (text.match(/DIAGNOSIS:\s*(.+)/i) || [])[1]?.trim();
    const recommendation = (text.match(/RECOMMENDATION:\s*(.+)/i) || [])[1]?.trim();
    if (!diagnosis && !recommendation) return null;
    return { finding, diagnosis, recommendation };
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, thinkingConfig: THINKING_CONFIG },
      }),
    },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function geminiGenerateGrounded(
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<{ text: string; sources: { title?: string; url?: string }[] }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { thinkingConfig: THINKING_CONFIG },
      }),
    },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const candidate = json?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || "";
  const sources = (candidate?.groundingMetadata?.groundingChunks || [])
    .map((c: { web?: { title?: string; uri?: string } }) => c?.web)
    .filter(Boolean)
    .map((w: { title?: string; uri?: string }) => ({ title: w.title, url: w.uri }));
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
