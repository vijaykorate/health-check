// BFF client for the EXISTING Pockit backend Health Check APIs.
//
// Server-side only. It injects the technician's Pockit JWT (`token`) plus the
// encrypted `apiKey`/`applicationKey` the backend's checkToken gate expects —
// so those secrets never reach the browser. There is NO Health Check business
// logic here: every call forwards to the Pockit backend, which remains the
// single source of truth (MySQL `health_checks` / Mongo `health_check_progress`).
//
// All Health Check routes live under POCKIT_BASE_URL (…/auth/), the same base
// the Technician App and Customer App already use.
import { encryptPockit } from "./pockit";

const BASE = (process.env.POCKIT_BASE_URL ?? "https://pockit.pockitengineers.com/auth/").replace(
  /\/*$/,
  "/",
);
const API_KEY = process.env.POCKIT_API_KEY ?? "";
const APPLICATION_KEY = process.env.POCKIT_APPLICATION_KEY ?? "";

export interface HcResult<T = Record<string, unknown>> {
  /** HTTP status. Note: some backend handlers return HTTP 200 with a body
   *  `code` carrying the real status — `ok`/`message` below normalise both. */
  httpStatus: number;
  /** Normalised success: HTTP ok AND (no body `code`, or body `code` === 200). */
  ok: boolean;
  /** Best status to surface to the client (body `code` if present, else HTTP). */
  status: number;
  message: string | null;
  data: T;
}

export async function hcBackend<T = Record<string, unknown>>(
  path: string,
  opts: {
    method?: string;
    token?: string | null;
    body?: unknown;
    /** false for the pre-auth customer routes (e.g. /health-check/connect/pair). */
    auth?: boolean;
  } = {},
): Promise<HcResult<T>> {
  const { method = "GET", token = null, body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    headers.token = token ?? "";
    headers.apiKey = encryptPockit(API_KEY);
    headers.applicationKey = encryptPockit(APPLICATION_KEY);
  }
  let res: Response;
  try {
    res = await fetch(BASE + path.replace(/^\//, ""), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    // Backend unreachable (e.g. restarting during a deploy, or a network blip).
    // Return a normal HcResult instead of throwing so BFF routes surface a clean
    // message rather than a raw 500 with no body.
    return {
      httpStatus: 502,
      ok: false,
      status: 502,
      message: "Couldn't reach the server. Please try again.",
      data: {} as T,
    };
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = null;
  }
  const bodyCode = typeof data?.code === "number" ? (data!.code as number) : undefined;
  const ok = res.ok && (bodyCode === undefined || bodyCode === 200);
  const message =
    (typeof data?.message === "string" && (data!.message as string)) ||
    (typeof data?.error === "string" && (data!.error as string)) ||
    null;
  return {
    httpStatus: res.status,
    ok,
    status: bodyCode ?? res.status,
    message,
    data: (data ?? {}) as T,
  };
}

/** Absolute URL to a backend-hosted asset (launcher download / report PDF).
 *  These are served BY THE BACKEND (the diagnostic scripts post back there),
 *  so the browser must hit the backend origin, not this app. */
export function backendUrl(path: string): string {
  return BASE + path.replace(/^\//, "");
}
