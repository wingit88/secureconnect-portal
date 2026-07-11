import type { NextRequest } from "next/server";

/** Student hotspot VLAN — admin routes must not be reachable from here. */
const STUDENT_VLAN_PREFIX = "192.168.30.";

export function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return req.ip ?? null;
}

export function isStudentVlanIp(ip: string | null): boolean {
  if (!ip) return false;

  const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  return normalized.startsWith(STUDENT_VLAN_PREFIX);
}
