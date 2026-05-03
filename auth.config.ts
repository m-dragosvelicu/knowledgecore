import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

// Credentials provider is available in development by default, and in production
// only if ALLOW_DEMO_AUTH=true (used for the public thesis demo). Lazy-imports
// prisma so this file stays edge-safe for middleware.
const allowCredentials =
  process.env.NODE_ENV !== "production" ||
  process.env.ALLOW_DEMO_AUTH === "true";
const devCredentials = Credentials({
  id: "credentials",
  name: "Dev sign-in",
  credentials: {
    email: { label: "Email", type: "email" },
  },
  async authorize(credentials) {
    const email =
      typeof credentials?.email === "string" ? credentials.email.trim() : "";
    if (!email) return null;
    const { prisma } = await import("@/lib/db");
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: email.split("@")[0] },
    });
    return { id: user.id, email: user.email ?? email, name: user.name ?? email.split("@")[0] };
  },
});

export const authConfig = {
  providers: allowCredentials ? [Google, devCredentials] : [Google],
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
