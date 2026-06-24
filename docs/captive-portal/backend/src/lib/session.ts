import type { SessionOptions } from "iron-session";

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