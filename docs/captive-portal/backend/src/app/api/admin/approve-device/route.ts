import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { approveDevice } from "@/lib/mikrotik";
import { normalize } from "@/lib/mac";

export const dynamic = "force-dynamic";
const schema = z.object({ deviceId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const device = await db.device.findUnique({
    where: { id: parsed.data.deviceId },
    include: { student: true },
  });
  if (!device) return new NextResponse("Not found", { status: 404 });
  if (device.student.status !== "ACTIVE") return new NextResponse("Student not ACTIVE", { status: 409 });

  const mac = normalize(device.macAddress);

  await db.device.update({
    where: { id: device.id },
    data: { approved: true, reason: null },
  });

  await db.auditLog.create({ data: { actor: session.email!, action: "device.approve", target: mac, meta: device.student.studentId } });

  // Keep the admin response fast; RouterOS sync can lag without blocking the UI.
  void approveDevice(device.student.studentId, mac).catch(async (err) => {
    console.error("approve-device ip-binding failed", err);
    await db.device.update({
      where: { id: device.id },
      data: { approved: false, reason: "router-bind-failed" },
    }).catch(() => {});
  });

  return NextResponse.json({ ok: true });
}