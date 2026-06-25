import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type AdminSession } from "@/lib/session";

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;

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