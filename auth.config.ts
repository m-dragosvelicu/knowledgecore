import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-safe config: providers and callbacks here run inside middleware, so
// they MUST NOT import Prisma or any other Node-only module. The full config,
// including the dev/demo Credentials provider and the Prisma adapter, is
// composed in `auth.ts` and used by API routes and server components.
export const authConfig = {
  providers: [Google],
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
