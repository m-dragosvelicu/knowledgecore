import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { anonymous } from "better-auth/plugins/anonymous";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // DEV: kept false so the app runs without a transactional email provider.
    // Flip to true (and wire sendResetPassword / sendVerificationEmail) before any
    // public launch. Email infra is a deferred Founder-dependency. (Landing-flow
    // D5: verification stays off for this launch.)
    requireEmailVerification: false,
    // TODO(auth): wire a real transactional email provider (Resend/SES) and
    // implement password reset. Stubbed until email infra exists.
  },
  // DEV-ONLY: trust localhost and any ngrok tunnel origin for phone preview.
  ...(process.env.NODE_ENV !== "production"
    ? { trustedOrigins: ["http://localhost:3000", "https://*.ngrok-free.app"] }
    : {}),
  plugins: [
    // Try-before-signup: a first-visit guest gets a real (isAnonymous=true) User
    // row + a normal session cookie, so the entire pre-journey flow and the
    // getOrCreateActiveIntent resume machinery work unchanged under that guest
    // userId. The plugin runs onLinkAccount when the guest later signs up / in,
    // then deletes the guest user. Because we re-point the journey OFF the guest
    // first (below), the cascade deletes nothing of value.
    anonymous({
      // Temporary guest emails are temp-<id>@<domain>; keep them off the real
      // user namespace. Cosmetic only (the guest never sees this address).
      emailDomainName: "guest.knowledgecore.local",
      // Claim-on-signup (landing-flow plan section 4). Fires server-side during
      // the email signup OR sign-in of a session that is currently anonymous.
      // Re-owns the whole journey atomically by re-pointing the single owning FK
      // (LearningIntent.userId) plus the denormalised LearnerProfile.userId.
      // Everything else (Subject / Goal / Outcome / Assessment / Path /
      // Goalpost / Step / CheckpointEvaluation / snapshots) hangs off intentId
      // or profileId and is carried for free.
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        const anonId = anonymousUser.user.id;
        const newId = newUser.user.id;
        // Guard: never merge a user into itself (would be a no-op move but the
        // plugin would still then delete the "anonymous" user, which is now the
        // real account). isSameUser is also re-checked by the plugin before its
        // own cleanup; this is defence in depth.
        if (!anonId || !newId || anonId === newId) return;
        await claimAnonymousJourney(anonId, newId);
      },
      // Keep the plugin's default deletion of the spent guest user ON: the move
      // above happens first, so the guest cascade removes only its now-empty row,
      // session and account.
    }),
    nextCookies(), // MUST be last in the array (required for cookies in server actions)
  ],
});

/**
 * Re-own every journey row keyed to an anonymous guest userId, moving it to the
 * target (real) account. Atomic: either the target owns the whole journey or
 * nothing moved. Used by the onLinkAccount hook (covers both the new-account
 * signup case and the existing-account merge case, D3 — for an existing account
 * the target simply gains another intent; the home dashboard already lists
 * multiple intents and surfaces the freshest active one, so "keep both, freshest
 * active" needs no extra write).
 *
 * Exported so the deterministic verify script can exercise the exact same code
 * path the hook runs.
 */
export async function claimAnonymousJourney(
  anonymousUserId: string,
  newUserId: string,
): Promise<{ intentsMoved: number; profilesMoved: number }> {
  const [intents, profiles] = await prisma.$transaction([
    prisma.learningIntent.updateMany({
      where: { userId: anonymousUserId },
      data: { userId: newUserId },
    }),
    prisma.learnerProfile.updateMany({
      where: { userId: anonymousUserId },
      data: { userId: newUserId },
    }),
  ]);
  return { intentsMoved: intents.count, profilesMoved: profiles.count };
}

/**
 * Thin server-side session helper. Preserves the `session.user.id` contract the
 * ~10 existing consumers depend on. Returns null when there is no session.
 */
export async function getCurrentSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Is the current session a guest (Better Auth anonymous) session? The plugin
 * adds `isAnonymous` to the user; a real email account has it false/undefined.
 */
export function isAnonymousSession(
  session: Awaited<ReturnType<typeof getCurrentSession>>,
): boolean {
  return Boolean(
    (session?.user as { isAnonymous?: boolean | null } | undefined)?.isAnonymous,
  );
}
