import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeNormalize } from "@/lib/mac";

export const dynamic = "force-dynamic";

/**
 * GET /api/status?mac=AA:BB:CC:DD:EE:FF
 *
 * Returns the approval state for a device MAC so the waiting page can poll
 * and auto-submit the login form once the admin approves the student+device.
 *
 * Response: { approved: boolean, studentStatus: "PENDING"|"ACTIVE"|"DENIED"|null }
 */
export async function GET(req: NextRequest) {
  const mac = safeNormalize(req.nextUrl.searchParams.get("mac") ?? "");
  if (!mac) {
    return NextResponse.json({ approved: false, studentStatus: null }, { status: 400 });
  }

  const device = await db.device.findUnique({
    where: { macAddress: mac },
    include: { student: { select: { status: true } } },
  }).catch(() => null);

  return NextResponse.json({
    approved: device?.approved ?? false,
    studentStatus: device?.student?.status ?? null,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
