import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { anonymous } from 'better-auth/plugins/anonymous';
import { headers } from 'next/headers';

import { prisma } from '@/lib/db';

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: false,
    // TODO(auth): wire a real transactional email provider (Resend/SES) and
    // implement password reset. Stubbed until email infra exists.
  },
  // DEV-ONLY: trust localhost and any ngrok tunnel origin for phone preview.
  ...(process.env.NODE_ENV !== "production"
    ? { trustedOrigins: ["http://localhost:3000", "https://*.ngrok-free.app"] }
    : {}),
  plugins: [
    anonymous({
      emailDomainName: "guest.knowledgecore.local",
      // Claim-on-signup. Fires server-side during the email signup
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        const anonId = anonymousUser.user.id;
        const newId = newUser.user.id;
        if (!anonId || !newId || anonId === newId) return;
        await claimAnonymousJourney(anonId, newId);
      },
      // Keep the plugin's default deletion of the spent guest user ON
    }),
    nextCookies(), // MUST be last in the array (required for cookies in server actions)
  ],
});

/**
 * Re-own every journey row keyed to an anonymous guest userId, moving it to the
 * target (real) account. Atomic: either the target owns the whole journey or
 * nothing moved. Used by onLinkAccount (new-account signup and existing-account
 * merge, D3 — an existing account just gains another intent, no extra write
 * needed). Exported so the deterministic verify script can exercise it too.
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
