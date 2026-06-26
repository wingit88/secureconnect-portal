import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { approveDevice } from "@/lib/mikrotik";
import { normalize } from "@/lib/mac";

export const dynamic = "force-dynamic";
const schema = z.object({ studentId: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.adminId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const student = await db.student.findUnique({
    where: { studentId: parsed.data.studentId },
    include: { devices: true },
  });
  if (!student) return new NextResponse("Not found", { status: 404 });

  const updated = await db.student.update({
    where: { id: student.id },
    data: { status: "ACTIVE" },
  });

  await db.auditLog.create({
    data: {
      actor: session.email ?? session.adminId,
      action: "student.approve",
      target: updated.studentId,
    },
  });

  // Auto-approve the first registration device so the waiting page can connect.
  const firstDevice = student.devices.find(
    (d) => !d.approved && d.reason === "first-registration",
  );
  if (firstDevice) {
    const mac = normalize(firstDevice.macAddress);
    await db.device.update({
      where: { id: firstDevice.id },
      data: { approved: true, reason: null },
    });
    void approveDevice(student.studentId, mac).catch(async (err) => {
      console.error("approve-student auto device approve failed", err);
      await db.device.update({
        where: { id: firstDevice.id },
        data: { approved: false, reason: "router-bind-failed" },
      }).catch(() => {});
    });
  }

  return NextResponse.json({ ok: true, autoApprovedDevice: !!firstDevice });
}
