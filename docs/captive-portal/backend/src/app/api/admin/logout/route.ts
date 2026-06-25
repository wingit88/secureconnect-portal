import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function POST() {
  const s = await requireAdmin();
  await s.destroy();
  return NextResponse.json({ ok: true });
}