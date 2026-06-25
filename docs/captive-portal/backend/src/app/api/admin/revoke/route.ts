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

  const s = await db.student.findUnique({
    where: { studentId: parsed.data.studentId },
    include: { devices: true },
  });
  if (!s) return new NextResponse("Not found", { status: 404 });

  await db.$transaction(async (tx) => {
    await tx.student.update({ where: { id: s.id }, data: { status: "DENIED" } });
    await tx.device.updateMany({ where: { studentId: s.id }, data: { approved: false } });
    await tx.auditLog.create({ data: { actor: session.email!, action: "student.revoke", target: s.studentId } });
    await enqueueRouterSyncTx(tx, "STUDENT_REVOKE", { studentId: s.id });
  });
  void drainRouterSyncQueue();
  return NextResponse.json({ ok: true, queued: true });
}