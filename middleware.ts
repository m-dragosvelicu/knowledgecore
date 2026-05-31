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
  // Dev-only design-system gallery: viewable without a session in development;
  // the page itself 404s in production, so this exemption is inert there.
  const isDevSpecimen =
    process.env.NODE_ENV !== "production" && pathname.startsWith("/specimens");

  if (!hasSession && !isAuthRoute && !isDevSpecimen) {
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
