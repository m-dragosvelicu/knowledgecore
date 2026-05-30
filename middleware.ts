import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// NOTE: This is an OPTIMISTIC cookie-presence check only — it does NOT validate
// the session against the database. It exists purely for the redirect UX (bounce
// unauthenticated navigations to /signin). The real auth gate lives in the server
// components / server actions, which all call `getCurrentSession()` /
// `auth.api.getSession()` and enforce identity. Do not treat this as the security
// boundary. (Next 15.1.x has no Node middleware runtime, so a DB-backed check in
// middleware is not available without bumping to >=15.2.)
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/signin" || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = new URL("/signin", request.nextUrl.origin);
    url.searchParams.set("callbackUrl", request.nextUrl.href);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
