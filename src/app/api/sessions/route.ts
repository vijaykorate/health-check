// GET /api/sessions — dashboard/history list (feature 5 shows running rows +
// stalled flag; feature 2 shows the health score per row).
import { NextResponse } from "next/server";
import { listSummaries } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ sessions: listSummaries() });
}
