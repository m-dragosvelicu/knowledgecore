import { redirect } from 'next/navigation';

import { getCurrentSession, isAnonymousSession } from '@/lib/auth';

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

// ---------------------------------------------------------------------------
// Ops/admin gate — no admin/role column exists in the schema yet. Gates on an
// ADMIN_EMAILS allowlist env var (comma-separated, case-insensitive), mirroring
// the app's existing env-var-gated feature pattern (the GOOGLE_GENAI_API_KEY /
// TAVILY_API_KEY fail-fast checks in lib/services/index.ts). Fails CLOSED: an
// unset/empty ADMIN_EMAILS means nobody can reach an admin surface, not everyone.
// Used by the LLM cost aggregation route + dashboard (cost-sensitive: reveals
// per-user/per-journey spend, not a product surface).
// ---------------------------------------------------------------------------

function parseAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseAdminEmails().has(email.toLowerCase());
}

/**
 * The current session iff it belongs to a real (non-guest), authenticated,
 * allow-listed admin account; otherwise null. Returns null rather than
 * redirecting so callers (API route vs. page) can each choose their own
 * response (401/403 JSON vs. a redirect/message).
 */
export async function currentAdminSession() {
  const session = await getCurrentSession();
  if (!session?.user?.id) return null;
  if (isAnonymousSession(session)) return null;
  if (!isAdminEmail(session.user.email)) return null;
  return session;
}
