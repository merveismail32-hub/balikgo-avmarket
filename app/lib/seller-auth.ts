import "server-only";

import { auth } from "@/auth";
import { prisma } from "./prisma";
import { redirect } from "next/navigation";

export async function getApprovedSeller() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SELLER") return null;
  return prisma.sellerProfile.findFirst({ where: { userId: session.user.id, status: "APPROVED" } });
}

/** Existing-order operations only; never use this for catalog, product, or sales access. */
export async function getSellerForFulfillment() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SELLER") return null;
  return prisma.sellerProfile.findFirst({
    where: { userId: session.user.id, status: { in: ["APPROVED", "SUSPENDED"] } },
  });
}

export async function requireApprovedSeller() {
  const seller = await getApprovedSeller();
  if (!seller) redirect("/satici-basvuru");
  return seller;
}
