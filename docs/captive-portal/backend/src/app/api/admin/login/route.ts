import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, verify } from "@/lib/auth";
import { adminLoginSchema } from "@/lib/validators";
import { take } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!take(`admin-login:${ip}`, 5, 0.05)) return new NextResponse("Too many attempts", { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  const user = await db.adminUser.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  // verify even when user missing to avoid timing oracle
  const ok = user ? await verify(user.passwordHash, parsed.data.password) : await verify("$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", parsed.data.password).catch(() => false);
  if (!user || !ok) return new NextResponse("Invalid credentials", { status: 401 });

  const session = await getSession();
  session.adminId = user.id;
  session.email = user.email;
  session.loggedInAt = Date.now();
  await session.save();

  await db.auditLog.create({ data: { actor: user.email, action: "admin.login" } });
  return NextResponse.json({ ok: true });
}