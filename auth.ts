import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/app/lib/prisma";
import type { UserRole } from "@prisma/client";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/giris" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
        if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return null;

        return { id: user.id, name: user.name, email: user.email, surname: user.surname, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const userId = user?.id ?? (typeof token.id === "string" ? token.id : undefined);
      if (userId) {
        const currentUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, surname: true, email: true, role: true },
        });
        if (currentUser) {
          token.id = currentUser.id;
          token.name = currentUser.name;
          token.email = currentUser.email;
          token.surname = currentUser.surname;
          token.role = currentUser.role;
        }
      }
      return token;
    },
    session({ session, token }) {
      const isRole = (value: unknown): value is UserRole =>
        value === "CUSTOMER" || value === "SELLER" || value === "ADMIN";
      if (session.user && typeof token.id === "string" && typeof token.name === "string" && typeof token.email === "string" && typeof token.surname === "string" && isRole(token.role)) {
        session.user.id = token.id;
        session.user.name = token.name;
        session.user.email = token.email;
        session.user.surname = token.surname;
        session.user.role = token.role;
      }
      return session;
    },
  },
});
