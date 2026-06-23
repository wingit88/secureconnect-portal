import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
const schema = z.object({ studentId: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const updated = await db.student.update({
    where: { studentId: parsed.data.studentId },
    data: { status: "ACTIVE" },
  });
  await db.auditLog.create({ data: { actor: session.email!, action: "student.approve", target: updated.studentId } });
  return NextResponse.json({ ok: true });
}