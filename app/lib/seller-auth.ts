import "server-only";

import { auth } from "@/auth";
import { prisma } from "./prisma";
import { redirect } from "next/navigation";

export async function getApprovedSeller() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SELLER") return null;
  return prisma.sellerProfile.findFirst({ where: { userId: session.user.id, status: "APPROVED" } });
}

export async function requireApprovedSeller() {
  const seller = await getApprovedSeller();
  if (!seller) redirect("/satici-basvuru");
  return seller;
}
