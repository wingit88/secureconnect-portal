import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
const schema = z.object({
  studentId: z.string().min(1).max(64),
  speedLimitKbps: z.number().int().min(0),
});

export async function POST(req: NextRequest) {
  const session = await requireAdmin();

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const student = await db.student.findUnique({ where: { studentId: parsed.data.studentId } });
  if (!student) return new NextResponse("Student not found", { status: 404 });

  await db.student.update({
    where: { id: student.id },
    data: { speedLimitKbps: parsed.data.speedLimitKbps },
  });

  await db.auditLog.create({
    data: {
      actor: session.email ?? "unknown",
      action: "student.set-speed-limit",
      target: student.studentId,
      meta: String(parsed.data.speedLimitKbps),
    },
  });

  return NextResponse.json({ ok: true });
}
