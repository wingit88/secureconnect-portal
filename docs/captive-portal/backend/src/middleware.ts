import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { getClientIp, isStudentVlanIp } from "@/lib/client-ip";
import { sessionOptions, type AdminSession } from "@/lib/session";
// Ensure the node-routeros Channel patch runs early on the server process.
import "@/lib/mikrotik-patch";

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

function forbiddenFromStudentVlan(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(
    "<!DOCTYPE html><html><head><title>Forbidden</title></head><body><p>Admin access is not available from the student network.</p></body></html>",
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;

  if (isStudentVlanIp(getClientIp(req))) {
    return forbiddenFromStudentVlan(req);
  }

  // allow the login endpoints unauthenticated
  if (url.pathname === "/admin/login" || url.pathname === "/api/admin/login") {
    return NextResponse.next();
  }

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