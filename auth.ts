import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/db";

const allowCredentials =
  process.env.NODE_ENV !== "production" ||
  process.env.ALLOW_DEMO_AUTH === "true";

const credentialsProvider = Credentials({
  id: "credentials",
  name: "Demo sign-in",
  credentials: {
    email: { label: "Email", type: "email" },
  },
  async authorize(credentials) {
    const email =
      typeof credentials?.email === "string" ? credentials.email.trim() : "";
    if (!email) return null;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: email.split("@")[0] },
    });
    return {
      id: user.id,
      email: user.email ?? email,
      name: user.name ?? email.split("@")[0],
    };
  },
});

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: allowCredentials
    ? [...authConfig.providers, credentialsProvider]
    : authConfig.providers,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
});
