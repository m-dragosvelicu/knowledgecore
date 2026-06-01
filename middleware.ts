import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Edge-safe middleware: this is an OPTIMISTIC cookie-presence check only — it
// must not import the Prisma-backed `auth` instance (Node APIs are unavailable
// in the Edge runtime). The authoritative session check runs in server
// components / actions via getCurrentSession(); middleware is just a fast UX
// redirect to keep users without ANY session out of the gated app routes.
//
// Try-before-signup (landing-flow plan, section 1b): the landing page and the
// four pre-journey routes are PUBLIC so an unauthenticated visitor can run the
// whole intent -> outcome -> probe -> path-overview flow before committing.
// Crucial subtlety: a guest adopted via the anonymous plugin DOES have a session
// cookie, so this optimistic check passes for guests on the gated routes too.
// That gap is closed by requireRealUserId() in the server actions / learning
// pages (acceptPathAction, /journey/goalpost, etc.) — middleware stays a UX
// redirect only.
const PUBLIC_EXACT = new Set<string>([
  "/",
  "/signin",
  "/journey/intent",
  "/journey/outcome",
  "/journey/probe",
  "/journey/path",
  "/journey/begin", // the create-account gate step (reachable by guests)
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/api/auth")) return true;
  // Dev-only design-system gallery: viewable without a session in development;
  // the page itself 404s in production, so this exemption is inert there.
  if (process.env.NODE_ENV !== "production" && pathname.startsWith("/specimens")) {
    return true;
  }
  return false;
}

export function middleware(request: NextRequest) {
  const hasSession = !!getSessionCookie(request);
  const { pathname } = request.nextUrl;

  if (!hasSession && !isPublicPath(pathname)) {
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
