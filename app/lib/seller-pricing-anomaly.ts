import "server-only";

import type { PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { getSellerInternalPriceBenchmark } from "./internal-price-benchmark";
import { evaluatePricingAnomaly } from "./pricing-anomaly";

type AnomalyClient = Pick<PrismaClient, "sellerOffer" | "sellerOfferPriceObservation">;

export async function getSellerPricingAnomalyEvaluation(input: Readonly<{ sellerId: string; sellerOfferId: string; evaluatedAt?: Date }>, client: AnomalyClient = prisma) {
  const benchmark = await getSellerInternalPriceBenchmark({ sellerId: input.sellerId, sellerOfferId: input.sellerOfferId }, client);
  if (!benchmark) return null;
  const [latest, observationCount] = await Promise.all([
    client.sellerOfferPriceObservation.findFirst({ where: { sellerOfferId: input.sellerOfferId, sellerId: input.sellerId }, orderBy: { priceVersion: "desc" }, select: { amount: true, previousAmount: true, observedAt: true } }),
    client.sellerOfferPriceObservation.count({ where: { sellerOfferId: input.sellerOfferId, sellerId: input.sellerId } }),
  ]);
  const currentMatchesLatest = latest?.amount.toFixed(2) === benchmark.targetPrice;
  return evaluatePricingAnomaly({ benchmark, history: { previousPrice: currentMatchesLatest ? latest.previousAmount : null, observationCount, lastObservedAt: currentMatchesLatest ? latest.observedAt : null }, evaluatedAt: input.evaluatedAt ?? new Date() });
}
