import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { refreshDeviceHostnames } from "@/lib/device-sync";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const student = await db.student.findUnique({
    where: { id: params.id },
    include: { devices: { orderBy: { createdAt: "desc" } } },
  });
  if (!student) return new NextResponse("Not found", { status: 404 });

  await refreshDeviceHostnames(student.devices).catch(() => {});

  const refreshed = await db.student.findUnique({
    where: { id: params.id },
    include: { devices: { orderBy: { createdAt: "desc" } } },
  });

  return NextResponse.json({ student: refreshed ?? student });
}
