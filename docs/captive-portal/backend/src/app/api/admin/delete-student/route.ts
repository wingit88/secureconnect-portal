import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { disconnectByMac, removeAllUsersForStudent } from "@/lib/mikrotik";

export const dynamic = "force-dynamic";
const schema = z.object({ studentId: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const student = await db.student.findUnique({
    where: { studentId: parsed.data.studentId },
    include: { devices: true },
  });
  if (!student) return new NextResponse("Not found", { status: 404 });

  try {
    await removeAllUsersForStudent(student.studentId);
    for (const device of student.devices) await disconnectByMac(device.macAddress).catch(() => {});
  } catch (err) {
    console.error("delete-student router cleanup failed", err);
  }

  await db.student.delete({ where: { id: student.id } });
  await db.auditLog.create({ data: { actor: session.email!, action: "student.delete", target: student.studentId } });
  return NextResponse.json({ ok: true });
}