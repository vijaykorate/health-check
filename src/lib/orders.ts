// Order-number helpers. The app keys everything off the internal ORDER_ID (e.g.
// "749" — the /orders/[orderId] param + v1/orders/:orderId backend calls). The
// human-facing *order number* ("ORD/YYYYMMDD/NNNNN", e.g. "ORD/20261005/00696")
// is a separate backend field we only surface for display + the download filename.

/** Pull the human-facing order number out of a raw backend payload, trying the
 *  field names the Pockit backend uses (snake_case on the diagnostics detail,
 *  UPPER_SNAKE on the job-card rows). Returns null when none is present so callers
 *  can fall back to the internal order id. */
export function extractOrderNo(
  raw: Record<string, unknown> | null | undefined,
): string | null {
  if (!raw) return null;
  const keys = [
    "order_no",
    "order_number",
    "service_order_no",
    "service_order_number",
    "order_code",
    "orderNo",
    "orderNumber",
    "ORDER_NO",
    "ORDER_NUMBER",
    "SERVICE_ORDER_NO",
    "SERVICE_ORDER_NUMBER",
  ];
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Download filename for a report PDF, based on the order number. Slashes (and any
 *  other filesystem-illegal characters) are replaced with "_", so
 *  "ORD/20261005/00696" → "ORD_20261005_00696_pockitengineers.pdf". Falls back to
 *  the session id when the order number is unavailable. */
export function reportFilename(
  orderNo: string | null | undefined,
  fallbackId: string,
): string {
  const base = (orderNo && orderNo.trim()) || fallbackId || "health-check";
  const safe = base.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${safe || "health-check"}_pockitengineers.pdf`;
}
