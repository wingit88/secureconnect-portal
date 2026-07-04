import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { approveDevice } from "@/lib/mikrotik";
import { normalize } from "@/lib/mac";
import { refreshDeviceHostname } from "@/lib/device-sync";

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
  if (device.student.status !== "ACTIVE") {
    return new NextResponse("Approve or re-approve the student first", { status: 409 });
  }

  const mac = normalize(device.macAddress);
  const wasApproved = device.approved;
  const hostname = await refreshDeviceHostname(mac, device.id).catch(() => null);

  await db.device.update({
    where: { id: device.id },
    data: {
      approved: true,
      reason: null,
      ...(hostname ? { hostname } : {}),
    },
  });

  await db.auditLog.create({
    data: {
      actor: session.email ?? session.adminId,
      action: wasApproved ? "device.reapprove" : "device.approve",
      target: mac,
      meta: device.student.studentId,
    },
  });

  try {
    await approveDevice(device.student.studentId, mac);
  } catch (err) {
    console.error("approve-device hotspot-user sync failed", err);
    await db.device.update({
      where: { id: device.id },
      data: { approved: false, reason: "router-bind-failed" },
    }).catch(() => {});
    return new NextResponse("Router sync failed, please retry", { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
