import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revokeDevice } from "@/lib/mikrotik";

export const dynamic = "force-dynamic";
const schema = z.object({ deviceId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const device = await db.device.findUnique({ where: { id: parsed.data.deviceId } });
  if (!device) return new NextResponse("Not found", { status: 404 });

  await revokeDevice(device.macAddress).catch(() => {});
  await db.device.delete({ where: { id: device.id } });
  await db.auditLog.create({ data: { actor: session.email!, action: "device.reject", target: device.macAddress } });
  return NextResponse.json({ ok: true });
}