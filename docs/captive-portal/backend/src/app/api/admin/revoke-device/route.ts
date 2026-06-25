import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { drainRouterSyncQueue, enqueueRouterSyncTx } from "@/lib/routerSync";

export const dynamic = "force-dynamic";
const schema = z.object({ deviceId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const device = await db.device.findUnique({ where: { id: parsed.data.deviceId }, include: { student: true } });
  if (!device) return new NextResponse("Not found", { status: 404 });

  await db.$transaction(async (tx) => {
    await tx.device.update({ where: { id: device.id }, data: { approved: false } });
    await tx.auditLog.create({ data: { actor: session.email!, action: "device.revoke", target: device.macAddress, meta: device.studentId } });
    await enqueueRouterSyncTx(tx, "DEVICE_REVOKE", {
      deviceId: device.id,
      studentId: device.studentId,
      mac: device.macAddress,
    });
  });
  void drainRouterSyncQueue();
  return NextResponse.json({ ok: true, queued: true });
}
