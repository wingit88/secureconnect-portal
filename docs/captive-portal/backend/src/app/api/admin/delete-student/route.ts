import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { drainRouterSyncQueue, enqueueRouterSyncTx } from "@/lib/routerSync";

export const dynamic = "force-dynamic";
const schema = z.object({ studentId: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const student = await db.student.findUnique({
    where: { studentId: parsed.data.studentId },
    include: { devices: true },
  });
  if (!student) return new NextResponse("Not found", { status: 404 });

  await db.$transaction(async (tx) => {
    await tx.auditLog.create({ data: { actor: session.email!, action: "student.delete", target: student.studentId } });
    await enqueueRouterSyncTx(tx, "STUDENT_DELETE", {
      studentCode: student.studentId,
      macList: student.devices.map((d) => d.macAddress),
    });
    await tx.student.delete({ where: { id: student.id } });
  });
  void drainRouterSyncQueue();
  return NextResponse.json({ ok: true, queued: true });
}