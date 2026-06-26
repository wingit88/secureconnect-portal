import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const students = await db.student.findMany({
    where: {
      ...(q ? {
        OR: [
          { studentId: { contains: q } },
          { nama: { contains: q } },
          { kelas: { contains: q } },
        ],
      } : {}),
      ...(status && ["PENDING", "ACTIVE", "DENIED"].includes(status) ? { status: status as "PENDING" | "ACTIVE" | "DENIED" } : {}),
    },
    include: { devices: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ students });
}