import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { disconnectByMac, removeHotspotUserByMac } from "@/lib/mikrotik";

export const dynamic = "force-dynamic";
const schema = z.object({ deviceId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const device = await db.device.findUnique({ where: { id: parsed.data.deviceId }, include: { student: true } });
  if (!device) return new NextResponse("Not found", { status: 404 });

  // Mark as not approved and attempt to disconnect/remove router bindings.
  await db.device.update({ where: { id: device.id }, data: { approved: false } });
  try {
    await disconnectByMac(device.macAddress).catch(() => {});
    await removeHotspotUserByMac(device.macAddress).catch(() => {});
  } catch (err) {
    console.error("revoke-device router cleanup failed", err);
  }
  await db.auditLog.create({ data: { actor: session.email!, action: "device.revoke", target: device.macAddress, meta: device.studentId } });
  return NextResponse.json({ ok: true });
}
