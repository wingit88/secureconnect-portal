import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revokeDevice } from "@/lib/mikrotik";
import { normalize } from "@/lib/mac";

export const dynamic = "force-dynamic";
const schema = z.object({ deviceId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.adminId) return new NextResponse("Unauthorized", { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const device = await db.device.findUnique({
    where: { id: parsed.data.deviceId },
    include: { student: true },
  });
  if (!device) return new NextResponse("Not found", { status: 404 });
  if (!device.approved) return new NextResponse("Device is not approved", { status: 409 });

  const mac = normalize(device.macAddress);

  await db.device.update({
    where: { id: device.id },
    data: { approved: false, reason: "revoked-by-admin" },
  });

  await db.auditLog.create({
    data: {
      actor: session.email ?? session.adminId,
      action: "device.revoke",
      target: mac,
      meta: device.student.studentId,
    },
  });

  void revokeDevice(mac).catch((err) => {
    console.error("revoke-device router cleanup failed", err);
  });

  return NextResponse.json({ ok: true });
}
