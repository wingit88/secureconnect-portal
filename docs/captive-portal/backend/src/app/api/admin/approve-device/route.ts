import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { normalize } from "@/lib/mac";
import { drainRouterSyncQueueForDevice, enqueueRouterSyncTx } from "@/lib/routerSync";

export const dynamic = "force-dynamic";
const schema = z.object({ deviceId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const device = await db.device.findUnique({
    where: { id: parsed.data.deviceId },
    include: { student: true },
  });
  if (!device) return new NextResponse("Not found", { status: 404 });
  if (device.student.status !== "ACTIVE") return new NextResponse("Student not ACTIVE", { status: 409 });

  const mac = normalize(device.macAddress);
  // Username: studentId for the first device, studentId#N for additional ones.
  const siblings = await db.device.count({ where: { studentId: device.studentId, approved: true } });
  const username = siblings === 0 ? device.student.studentId : `${device.student.studentId}#${siblings + 1}`;
  await db.$transaction(async (tx) => {
    await tx.device.update({
      where: { id: device.id },
      data: { approved: true, reason: null },
    });
    await tx.auditLog.create({ data: { actor: session.email!, action: "device.approve", target: mac, meta: device.student.studentId } });
    await enqueueRouterSyncTx(tx, "DEVICE_APPROVE", {
      deviceId: device.id,
      studentId: device.studentId,
      username,
      mac,
      speedLimitKbps: device.student.speedLimitKbps ?? undefined,
    });
  });
  // Try to process this specific device's approve job immediately.
  await drainRouterSyncQueueForDevice(device.id, "DEVICE_APPROVE");

  return NextResponse.json({ ok: true, queued: true, username });
}