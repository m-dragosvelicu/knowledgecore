import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

const isProd = process.env.NODE_ENV === "production";

// Dev-only credentials provider: skips OAuth so local development does not need
// real Google secrets. Lazy-imports prisma so this file stays edge-safe for
// middleware.
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
  providers: isProd ? [Google] : [Google, devCredentials],
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
