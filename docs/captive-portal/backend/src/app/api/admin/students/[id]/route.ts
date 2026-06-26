import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { refreshDeviceHostnames } from "@/lib/device-sync";
import { routeId } from "@/lib/route-params";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  const id = await routeId(params);
  if (!id) return new NextResponse("Not found", { status: 404 });

  const student = await db.student.findUnique({
    where: { id },
    include: { devices: { orderBy: { createdAt: "desc" } } },
  });
  if (!student) return new NextResponse("Not found", { status: 404 });

  // Hostname refresh is best-effort; never block or fail the response.
  void refreshDeviceHostnames(student.devices).catch(() => {});

  return NextResponse.json({ student });
}
