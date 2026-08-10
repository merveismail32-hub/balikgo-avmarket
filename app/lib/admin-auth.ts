import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  return session.user;
}

export async function isAdmin() {
  const session = await auth();
  return session?.user?.role === "ADMIN";
}
