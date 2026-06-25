import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { removeAllUsersForStudent, disconnectByMac } from "@/lib/mikrotik";

export const dynamic = "force-dynamic";
const schema = z.object({ studentId: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const s = await db.student.findUnique({
    where: { studentId: parsed.data.studentId },
    include: { devices: true },
  });
  if (!s) return new NextResponse("Not found", { status: 404 });

  await db.student.update({ where: { id: s.id }, data: { status: "DENIED" } });
  try {
    await removeAllUsersForStudent(s.studentId);
    for (const d of s.devices) await disconnectByMac(d.macAddress).catch(() => {});
  } catch (err) {
    console.error("revoke router cleanup failed", err);
  }
  await db.device.updateMany({ where: { studentId: s.id }, data: { approved: false } });
  await db.auditLog.create({ data: { actor: session.email!, action: "student.revoke", target: s.studentId } });
  return NextResponse.json({ ok: true });
}