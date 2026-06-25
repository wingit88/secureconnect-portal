import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type AdminSession } from "@/lib/session";

/*
  Client IP detection order (best-effort):
  1. `req.ip` (available when Next runs in a Node server runtime where the platform
     populates `req.ip` or when using adapters that expose it).
  2. `x-forwarded-for` / `x-real-ip` headers (set by reverse proxies like nginx).
  3. Fallback to empty string — middleware then requires auth.

  If you run the backend behind `nginx` or another proxy, ensure these headers
  are forwarded. Example `nginx` snippet for a proxy block:

    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Host $host;

  With Docker/traefik or cloud load balancers, consult their docs to enable
  forwarding of the client IP in `X-Forwarded-For`.
*/

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  // allow the login endpoints unauthenticated
  if (url.pathname === "/admin/login" || url.pathname === "/api/admin/login") {
    return NextResponse.next();
  }

  // Determine client IP from best available source: prefer `req.ip`, then headers.
  const ipFromReq = (req as any).ip || (req as any).socket?.remoteAddress || "";
  const xfwd = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
  const clientIp = (ipFromReq && String(ipFromReq).trim()) || xfwd.split(",")[0].trim() || "";

  // Simple /24 checks for local VLAN ranges. Keep this intentionally simple
  // and avoid heavy CIDR libraries so it can run in the Edge runtime.
  const isStudentVlan = clientIp.startsWith("192.168.30.");
  const isAdminVlan = clientIp.startsWith("192.168.10.") || clientIp.startsWith("192.168.20.");

  // If coming from the student VLAN, allow captive portal public endpoints
  // and block only admin endpoints.
  if (isStudentVlan) {
    if (url.pathname.startsWith("/api/admin")) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Explicitly allow the captive portal endpoints used by students.
    if (
      url.pathname === "/api/login" ||
      url.pathname === "/api/captive" ||
      url.pathname === "/api/denied" ||
      url.pathname === "/login" ||
      url.pathname === "/status"
    ) {
      return NextResponse.next();
    }

    if (url.pathname.startsWith("/api/")) {
      return NextResponse.next();
    }

    const redirectTo = url.clone();
    redirectTo.pathname = "/login";
    return NextResponse.redirect(redirectTo);
  }

  // For other networks allow only from admin VLANs unless authenticated.
  // If request originates from the admin VLAN we permit access to admin pages
  // and APIs even without a session (network-level protection).
  if (isAdminVlan) {
    return NextResponse.next();
  }

  // Fallback behavior: require an authenticated admin session for /admin and
  // /api/admin routes as before.
  const res = NextResponse.next();
  const session = await getIronSession<AdminSession>(req, res, sessionOptions);
  if (!session.adminId) {
    if (url.pathname.startsWith("/api/")) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const login = url.clone();
    login.pathname = "/admin/login";
    login.searchParams.set("next", url.pathname);
    return NextResponse.redirect(login);
  }
  return res;
}