import type { NextRequest } from "next/server";

const DEFAULT_PORTAL_PUBLIC_URL = "http://192.168.10.2";

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function normalizeBaseUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function resolveForwardedBase(req: NextRequest): string | null {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0]
    ?.trim();
  if (!host) return null;

  const hostname = host.split(":")[0] ?? "";
  if (!hostname || isLocalHost(hostname)) return null;

  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "") ?? "http";
  return `${proto}://${host}`;
}

/** Public origin students use to reach the captive portal (not localhost). */
export function portalPublicBase(req?: NextRequest): string {
  const configured = process.env.PORTAL_PUBLIC_URL?.trim();
  if (configured) {
    return normalizeBaseUrl(configured);
  }

  if (req) {
    const forwardedBase = resolveForwardedBase(req);
    if (forwardedBase) {
      return normalizeBaseUrl(forwardedBase);
    }
  }

  return DEFAULT_PORTAL_PUBLIC_URL;
}

export function portalUrl(path: string, req?: NextRequest): string {
  const base = portalPublicBase(req);
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function portalHomePath(searchParams?: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
    } else if (typeof value === "string") {
      params.append(key, value);
    }
  });

  const query = params.toString();
  return `/api/captive${query ? `?${query}` : ""}`;
}
