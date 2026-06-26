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

  const device = await db.device.findUnique({ where: { id: parsed.data.deviceId } });
  if (!device) return new NextResponse("Not found", { status: 404 });

  const mac = normalize(device.macAddress);

  await revokeDevice(mac).catch(() => {});
  await db.device.delete({ where: { id: device.id } });
  await db.auditLog.create({
    data: {
      actor: session.email ?? session.adminId,
      action: "device.reject",
      target: mac,
    },
  });
  return NextResponse.json({ ok: true });
}