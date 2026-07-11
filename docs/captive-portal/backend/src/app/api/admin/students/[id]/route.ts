import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { refreshDeviceHostnames } from "@/lib/device-sync";
import { routeId } from "@/lib/route-params";
import { normalizeStudentUpdateInput } from "@/lib/student-update";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  const id = await routeId(params);
  if (!id) return new NextResponse("Not found", { status: 404 });

  const student = await db.student.findUnique({
    where: { id },
    include: { devices: { orderBy: { createdAt: "desc" } } },
  });
  if (!student) return new NextResponse("Not found", { status: 404 });

  void refreshDeviceHostnames(student.devices).catch(() => {});

  return NextResponse.json({ student });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  const id = await routeId(params);
  if (!id) return new NextResponse("Not found", { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON body", { status: 400 });
  }

  try {
    const data = normalizeStudentUpdateInput({
      studentId: typeof body.studentId === "string" ? body.studentId : undefined,
      nama: typeof body.nama === "string" ? body.nama : undefined,
      kelas: typeof body.kelas === "string" ? body.kelas : undefined,
    });

    const existing = await db.student.findUnique({ where: { id } });
    if (!existing) return new NextResponse("Not found", { status: 404 });

    if (data.studentId && data.studentId !== existing.studentId) {
      const duplicate = await db.student.findUnique({ where: { studentId: data.studentId } });
      if (duplicate && duplicate.id !== id) {
        return new NextResponse("Student ID already exists", { status: 409 });
      }
    }

    const updated = await db.student.update({ where: { id }, data });
    return NextResponse.json({ ok: true, student: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update student";
    return new NextResponse(message, { status: 400 });
  }
}
