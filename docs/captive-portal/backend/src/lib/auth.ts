import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type AdminSession } from "./session";

export type { AdminSession } from "./session";

export async function getSession(): Promise<AdminSession & { save(): Promise<void>; destroy(): Promise<void> }> {
  // @ts-expect-error iron-session typing for cookies()
  return getIronSession<AdminSession>(cookies(), sessionOptions);
}

export async function requireAdmin() {
  const s = await getSession();
  if (!s.adminId) throw new Response("Unauthorized", { status: 401 });
  return s;
}

type Argon2Like = {
  argon2id: number;
  hash(password: string, options?: { type?: number }): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
};

async function loadArgon2(): Promise<Argon2Like> {
  const mod = await import("argon2");
  return ((mod as unknown as { default?: Argon2Like }).default ?? mod) as Argon2Like;
}

export async function hash(pw: string) {
  const argon2 = await loadArgon2();
  return argon2.hash(pw, { type: argon2.argon2id });
}

export async function verify(h: string, pw: string) {
  const argon2 = await loadArgon2();
  return argon2.verify(h, pw);
}