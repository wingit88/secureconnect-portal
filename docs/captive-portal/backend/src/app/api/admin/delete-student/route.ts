import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { deleteStudentAndDevices } from "@/lib/student-cleanup";

export const dynamic = "force-dynamic";
const schema = z.object({ studentId: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.adminId) return new NextResponse("Unauthorized", { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const student = await db.student.findUnique({
    where: { studentId: parsed.data.studentId },
    include: { devices: true },
  });
  if (!student) return new NextResponse("Not found", { status: 404 });

  const { devicesDeleted } = await deleteStudentAndDevices(student);

  await db.auditLog.create({
    data: {
      actor: session.email ?? session.adminId,
      action: "student.delete",
      target: student.studentId,
      meta: JSON.stringify({ devicesDeleted }),
    },
  });

  return NextResponse.json({ ok: true, devicesDeleted });
}
