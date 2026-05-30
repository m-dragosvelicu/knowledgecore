import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
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
    // public launch. Email infra is a deferred Founder-dependency.
    requireEmailVerification: false,
    // TODO(auth): wire a real transactional email provider (Resend/SES) and
    // implement password reset. Stubbed until email infra exists.
    // sendResetPassword: async ({ user, url }) => {
    //   // send `url` to `user.email`
    // },
  },
  plugins: [nextCookies()], // MUST be last in the array (required for cookies in server actions)
});

/**
 * Thin server-side session helper. Preserves the `session.user.id` contract the
 * ~10 existing consumers depend on. Returns null when there is no session.
 */
export async function getCurrentSession() {
  return auth.api.getSession({ headers: await headers() });
}
