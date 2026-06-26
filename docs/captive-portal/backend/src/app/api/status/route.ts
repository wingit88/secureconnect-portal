import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeNormalize } from "@/lib/mac";

export const dynamic = "force-dynamic";

/**
 * GET /api/status?mac=AA:BB:CC:DD:EE:FF
 *
 * Used by the waiting page to detect when the admin has approved both the
 * student account and this device.
 *
 * Response:
 *   ready          — true when student is ACTIVE and device is approved
 *   approved       — device.approved in the database
 *   studentStatus  — "PENDING" | "ACTIVE" | "DENIED" | null
 */
export async function GET(req: NextRequest) {
  const mac = safeNormalize(req.nextUrl.searchParams.get("mac") ?? "");
  if (!mac) {
    return NextResponse.json(
      { ready: false, approved: false, studentStatus: null },
      { status: 400 },
    );
  }

  const device = await db.device.findUnique({
    where: { macAddress: mac },
    include: { student: { select: { status: true } } },
  }).catch(() => null);

  const approved = device?.approved ?? false;
  const studentStatus = device?.student?.status ?? null;
  const ready = approved && studentStatus === "ACTIVE";

  return NextResponse.json(
    { ready, approved, studentStatus },
    { headers: { "Cache-Control": "no-store" } },
  );
}
