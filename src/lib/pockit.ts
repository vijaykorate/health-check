// Real Pockit technician auth. The Health Check login proxies to the same
// backend + endpoints the Pockit Technician App uses (app/technician/sendOTP /
// verifyOTP), so real technicians sign in here with their real OTP — no dummy
// data. Server-side only; the API/application keys live in env, never the client.
//
// The backend expects `apiKey` / `applicationKey` headers encrypted exactly the
// way the mobile app encrypts them: CryptoJS.AES.encrypt(text, SECRET_KEY) —
// i.e. OpenSSL "Salted__" format with an MD5 key-derivation. We reproduce that
// with Node crypto (no crypto-js dependency).
import crypto from "node:crypto";

const POCKIT_BASE_URL =
  process.env.POCKIT_BASE_URL ?? "https://pockit.pockitengineers.com/auth/";
const API_KEY = process.env.POCKIT_API_KEY ?? "";
const APPLICATION_KEY = process.env.POCKIT_APPLICATION_KEY ?? "";
const SECRET_KEY = process.env.POCKIT_SECRET_KEY ?? "POCKIT@321";
const DEFAULT_COUNTRY_CODE = process.env.POCKIT_COUNTRY_CODE ?? "+91";

/** OpenSSL EVP_BytesToKey (MD5, 1 iteration) — matches CryptoJS's passphrase KDF. */
function evpKDF(passphrase: Buffer, salt: Buffer, keyLen: number, ivLen: number) {
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < keyLen + ivLen) {
    block = crypto
      .createHash("md5")
      .update(Buffer.concat([block, passphrase, salt]))
      .digest();
    derived = Buffer.concat([derived, block]);
  }
  return {
    key: derived.subarray(0, keyLen),
    iv: derived.subarray(keyLen, keyLen + ivLen),
  };
}

/** CryptoJS.AES.encrypt(text, SECRET_KEY).toString() equivalent. */
export function encryptPockit(text: string): string {
  const salt = crypto.randomBytes(8);
  const { key, iv } = evpKDF(Buffer.from(SECRET_KEY, "utf8"), salt, 32, 16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("Salted__", "utf8"), salt, ct]).toString("base64");
}

interface PockitResponse {
  code?: number;
  message?: string;
  data?: Array<Record<string, unknown>>;
}

async function pockitPost(
  path: string,
  body: unknown,
  authToken = "",
): Promise<PockitResponse> {
  const res = await fetch(POCKIT_BASE_URL + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: authToken,
      apiKey: encryptPockit(API_KEY),
      applicationKey: encryptPockit(APPLICATION_KEY),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  // The backend returns JSON with a numeric `code`, even on business errors.
  return (await res.json().catch(() => ({}))) as PockitResponse;
}

/** Look up the technician's real profile with the token returned by verifyOTP —
 *  the same follow-up call the Pockit app makes (api/technician/get) — so we can
 *  show the real name instead of a fallback. */
async function fetchTechnicianName(token: string, userId: string): Promise<string | null> {
  try {
    const json = await pockitPost(
      "api/technician/get",
      { filter: ` AND ID = ${userId} ` },
      token,
    );
    const rec = json?.data?.[0];
    if (!rec) return null;
    const full = [rec.FIRST_NAME, rec.LAST_NAME].filter(Boolean).join(" ").trim();
    const name = String(
      rec.NAME ?? rec.FULL_NAME ?? rec.TECHNICIAN_NAME ?? rec.USER_NAME ?? full ?? "",
    ).trim();
    return name || null;
  } catch {
    return null;
  }
}

export interface PockitTechnician {
  id: string;
  name: string;
  mobile: string;
  /** Pockit backend token, used to call Pockit as this technician afterwards. */
  token: string;
}

export interface PockitJob {
  orderId: string;
  jobCardNo: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  manufacturer: string;
  model: string;
  deviceType: string;
  serviceType: string;
  territory: string;
  started: boolean;
}

export interface PockitAuthResult {
  ok: boolean;
  message?: string;
  technician?: PockitTechnician;
}

/** Send the technician login OTP (mirrors app/technician/sendOTP). */
export async function sendTechnicianOtp(
  mobile: string,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const json = await pockitPost("app/technician/sendOTP", {
      COUNTRY_CODE: countryCode,
      TYPE_VALUE: mobile,
      DEVICE_ID: "healthcheck-web",
      TYPE: "M",
    });
    if (json?.code === 200) return { ok: true };
    return { ok: false, message: json?.message ?? "Could not send OTP." };
  } catch {
    return { ok: false, message: "Couldn't reach the Pockit server." };
  }
}

/** Fetch the technician's assigned Health Check jobs from Pockit.
 *  Uses api/jobCard/getJobsForTechnician (the same endpoint the Technician App's
 *  dashboard uses for the assigned list) with TECHNICIAN_ID in the body — the
 *  raw api/jobCard/get endpoint returns code 400 for this login's token.
 *  Returns an array (possibly empty) on success, or **null** when the Pockit
 *  call fails/token is no longer valid — so callers can tell "session expired"
 *  apart from "genuinely no orders". */
export async function fetchTechnicianJobs(
  token: string,
  technicianId: string,
): Promise<PockitJob[] | null> {
  try {
    const json = await pockitPost(
      "api/jobCard/getJobsForTechnician",
      {
        TECHNICIAN_ID: technicianId,
        filter: ` AND TECHNICIAN_ID = ${technicianId} AND STATUS = "AS" `,
      },
      token,
    );
    // code 200 = query succeeded (data may be empty). Anything else (e.g. an
    // evicted/expired token → "Failed to get jobCard information") = failure.
    if (json?.code !== 200 || !Array.isArray(json.data)) return null;
    // Only Health Check jobs belong in this app — exclude other service types
    // (e.g. "Monsoon Ready Service", "Unknown issue"). Matched on the service
    // name; override the term with POCKIT_HEALTHCHECK_MATCH if it ever changes.
    const term = process.env.POCKIT_HEALTHCHECK_MATCH ?? "health\\s*check";
    const isHealthCheck = new RegExp(term, "i");
    const hcRows = json.data.filter((r) =>
      isHealthCheck.test(`${r.SERVICE_NAME ?? ""} ${r.SERVICE_FULL_NAME ?? ""}`),
    );
    // Return every assigned Health Check order, tagging whether the on-site job
    // has been STARTED (job_card.TRACK_STATUS === 'SJ'). Not-yet-started orders
    // surface as "Upcoming"; a scan can only begin once the job is started, which
    // the backend's createSession still enforces. If the backend never exposes
    // TRACK_STATUS, treat orders as started (don't gate) — the prior behaviour.
    const exposesTrackStatus = hcRows.some((r) => r.TRACK_STATUS != null);
    return hcRows
      .map((r) => ({
        orderId: String(r.ORDER_ID ?? r.ORDER_NO ?? r.ORDER_NUMBER ?? ""),
        jobCardNo: String(r.JOB_CARD_NO ?? r.JOB_CARD_NUMBER ?? ""),
        customerId: String(r.CUSTOMER_ID ?? ""),
        customerName: String(r.CUSTOMER_NAME ?? ""),
        customerMobile: String(r.CUSTOMER_MOBILE_NUMBER ?? r.CUSTOMER_MOBILE ?? ""),
        manufacturer: String(r.BRAND_NAME ?? ""),
        model: String(r.MODEL_NUMBER ?? ""),
        deviceType: String(r.DEVICE_TYPE ?? r.CATEGORY_NAME ?? ""),
        serviceType: String(r.SERVICE_NAME ?? r.SERVICE_FULL_NAME ?? ""),
        territory: String(r.TERRITORY_NAME ?? r.TERRITORY ?? ""),
        started: exposesTrackStatus
          ? String(r.TRACK_STATUS ?? "").toUpperCase() === "SJ"
          : true,
      }))
      .filter((j) => j.orderId);
  } catch {
    return null;
  }
}

/** Verify the technician OTP (mirrors app/technician/verifyOTP). */
export async function verifyTechnicianOtp(
  mobile: string,
  otp: string,
): Promise<PockitAuthResult> {
  try {
    const json = await pockitPost("app/technician/verifyOTP", {
      TYPE_VALUE: mobile,
      OTP: otp,
      CLOUD_ID: "",
      // Web session bucket ("W"), distinct from the Mobile App's "M"/"D" bucket,
      // so signing in here does not evict the technician's Mobile App session.
      DEVICE_TYPE: "W",
      DEVICE_ID: "healthcheck-web",
      DEVICE_NAME: "Health Check Web",
      DEVICE_IP: "",
      SESSION_KEY: "",
      TYPE: "M",
    });
    const first = json?.data?.[0];
    const userData = first?.UserData as Array<Record<string, unknown>> | undefined;
    const u = userData?.[0];
    if (json?.code === 200 && u) {
      const id = String(u.USER_ID ?? u.ID ?? "");
      const token = String(first?.token ?? "");
      const fullName = [u.FIRST_NAME, u.LAST_NAME].filter(Boolean).join(" ").trim();
      let name = String(u.NAME ?? (fullName || "")).trim();
      // verifyOTP's UserData is minimal; fetch the full profile for the real name.
      if (!name && token && id) {
        name = (await fetchTechnicianName(token, id)) ?? "";
      }
      return {
        ok: true,
        technician: {
          id,
          name: name || `Technician ${mobile}`,
          mobile: String(u.MOBILE_NUMBER ?? u.MOBILE ?? mobile),
          token,
        },
      };
    }
    return { ok: false, message: json?.message ?? "Invalid or expired OTP." };
  } catch {
    return { ok: false, message: "Couldn't reach the Pockit server." };
  }
}
