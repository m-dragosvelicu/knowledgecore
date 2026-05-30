import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Edge-safe middleware: this is an OPTIMISTIC cookie-presence check only — it
// must not import the Prisma-backed `auth` instance (Node APIs are unavailable
// in the Edge runtime). The authoritative session check runs in server
// components / actions via getCurrentSession(); middleware is just a fast UX
// redirect to keep unauthenticated users out of app routes.
export function middleware(request: NextRequest) {
  const hasSession = !!getSessionCookie(request);
  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname === "/signin" || pathname.startsWith("/api/auth");

  if (!hasSession && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    return NextResponse.redirect(url);
  }
  if (hasSession && pathname === "/signin") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
