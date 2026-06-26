import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revokeAllDevicesForStudent, revokeDevice } from "@/lib/mikrotik";

export const dynamic = "force-dynamic";
const schema = z.object({ studentId: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.adminId) return new NextResponse("Unauthorized", { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const s = await db.student.findUnique({
    where: { studentId: parsed.data.studentId },
    include: { devices: true },
  });
  if (!s) return new NextResponse("Not found", { status: 404 });

  await db.student.update({ where: { id: s.id }, data: { status: "DENIED" } });
  await db.device.updateMany({ where: { studentId: s.id }, data: { approved: false } });
  await db.auditLog.create({
    data: {
      actor: session.email ?? session.adminId,
      action: "student.deny",
      target: s.studentId,
    },
  });

  const routerStudentId = s.studentId;
  const devices = s.devices.map((d) => d.macAddress);
  void (async () => {
    try {
      await revokeAllDevicesForStudent(routerStudentId);
      for (const mac of devices) await revokeDevice(mac).catch(() => {});
    } catch (err) {
      console.error("deny-student router cleanup failed", err);
    }
  })();

  return NextResponse.json({ ok: true });
}
