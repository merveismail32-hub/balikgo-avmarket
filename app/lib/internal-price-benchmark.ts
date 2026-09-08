import "server-only";

import type { PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { calculateInternalPriceBenchmark } from "./pricing-benchmark";

type BenchmarkClient = Pick<PrismaClient, "sellerOffer">;

export async function getSellerInternalPriceBenchmark(
  input: Readonly<{ sellerId: string; sellerOfferId: string }>,
  client: BenchmarkClient = prisma,
) {
  const target = await client.sellerOffer.findFirst({ where: { id: input.sellerOfferId, sellerId: input.sellerId }, select: { id: true, sellerId: true, catalogProductId: true, price: true } });
  if (!target) return null;
  const comparables = await client.sellerOffer.findMany({
    where: {
      catalogProductId: target.catalogProductId,
      id: { not: target.id },
      active: true,
      priceAnomalyHeld: false,
      stock: { gt: 0 },
      seller: { status: "APPROVED" },
      catalogProduct: { active: true, moderationStatus: "APPROVED" },
    },
    select: { id: true, sellerId: true, catalogProductId: true, price: true },
    orderBy: { id: "asc" },
  });
  return calculateInternalPriceBenchmark({
    target: { sellerOfferId: target.id, sellerId: target.sellerId, catalogProductId: target.catalogProductId, price: target.price },
    comparables: comparables.map((offer) => ({ sellerOfferId: offer.id, sellerId: offer.sellerId, catalogProductId: offer.catalogProductId, price: offer.price })),
  });
}
