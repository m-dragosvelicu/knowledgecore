import { redirect } from "next/navigation";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Ownership guards (landing-flow plan, section 3a — defence in depth).
//
// A guest has a real Better Auth session (anonymous plugin), so the optimistic
// middleware cookie check passes for them. The authoritative gate therefore
// lives here, in the server components / actions:
//
//   requireOwnerId()    accepts anonymous + real — the PRE-JOURNEY surfaces
//                       (intent -> outcome -> probe -> path overview). A guest
//                       must be able to do the whole try-before-signup flow.
//
//   requireRealUserId() rejects anonymous (treats a guest like no session) —
//                       the LEARNING surfaces (goalpost onward) + acceptPath.
//                       Beginning to learn requires a real account.
// ---------------------------------------------------------------------------

/** A signal the create-account gate / sign-in is needed for the current user. */
export const GATE_REDIRECT = "/journey/begin";

/**
 * Owner id for the pre-journey flow. Accepts a guest (anonymous) session as a
 * first-class owner so the wizard + per-step writes work unchanged. Redirects
 * to /signin only when there is no session at all.
 */
export async function requireOwnerId(): Promise<string> {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/signin");
  }
  return session.user.id;
}

/**
 * Owner id for the learning surfaces. Rejects a guest (anonymous) session: a
 * guest is routed to the create-account gate instead of being let in. A user
 * with no session at all still goes to /signin (the middleware already blocks
 * the gated routes for the no-cookie case; this closes the anonymous-cookie
 * gap the middleware cannot see).
 */
export async function requireRealUserId(): Promise<string> {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/signin");
  }
  if (isAnonymousSession(session)) {
    redirect(GATE_REDIRECT);
  }
  return session.user.id;
}
