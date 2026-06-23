import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import argon2 from "argon2";

export type AdminSession = {
  adminId?: string;
  email?: string;
  loggedInAt?: number;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const sessionOptions: SessionOptions = {
  password: requireEnv("SESSION_SECRET"),
  cookieName: process.env.SESSION_COOKIE_NAME ?? "cp_admin",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.FORCE_HTTPS === "1",
    path: "/",
    maxAge: 60 * 60 * 8, // 8h sliding
  },
};

export async function getSession(): Promise<AdminSession & { save(): Promise<void>; destroy(): Promise<void> }> {
  // @ts-expect-error iron-session typing for cookies()
  return getIronSession<AdminSession>(cookies(), sessionOptions);
}

export async function requireAdmin() {
  const s = await getSession();
  if (!s.adminId) throw new Response("Unauthorized", { status: 401 });
  return s;
}

export const hash = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });
export const verify = (h: string, pw: string) => argon2.verify(h, pw);