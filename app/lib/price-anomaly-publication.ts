import "server-only";

import type { Prisma } from "@prisma/client";
import type { PricingAnomalyEvaluation } from "./pricing-anomaly";
import { PRICE_ANOMALY_ENFORCEMENT_VERSION, requiresAutomaticPriceHold } from "./price-anomaly-enforcement-policy";
import { getSellerPricingAnomalyEvaluation } from "./seller-pricing-anomaly";

function snapshot(evaluation: PricingAnomalyEvaluation) {
  return {
    anomalyStatus: evaluation.status,
    anomalyConfidence: evaluation.confidence,
    reasonCodes: [...evaluation.reasons],
    algorithmVersion: evaluation.algorithmVersion,
    benchmarkSnapshot: evaluation.benchmark,
    evaluatedAt: new Date(evaluation.evaluatedAt),
    enforcementPolicyVersion: PRICE_ANOMALY_ENFORCEMENT_VERSION,
  };
}

export async function enforcePriceAnomalyPublication(
  tx: Prisma.TransactionClient,
  input: Readonly<{ sellerOfferId: string; sellerId: string; expectedPriceVersion: number }>,
) {
  const [offer] = await tx.$queryRaw<Array<{ priceVersion: number; priceAnomalyHeld: boolean }>>`
    SELECT "priceVersion", "priceAnomalyHeld"
    FROM "SellerOffer"
    WHERE "id" = ${input.sellerOfferId} AND "sellerId" = ${input.sellerId}
    FOR UPDATE
  `;
  if (!offer || offer.priceVersion !== input.expectedPriceVersion) return { action: "STALE" as const };
  const evaluation = await getSellerPricingAnomalyEvaluation({ sellerId: input.sellerId, sellerOfferId: input.sellerOfferId }, tx);
  if (!evaluation) return { action: "STALE" as const };
  const activeKey = `PRICE_ANOMALY:${input.sellerOfferId}`;
  const active = await tx.sellerOfferPriceAnomalyHold.findUnique({ where: { activeKey } });
  if (offer.priceAnomalyHeld !== Boolean(active)) throw new Error("PRICE_ANOMALY_HOLD_STATE_INCONSISTENT");
  if (requiresAutomaticPriceHold(evaluation)) {
    if (active) return { action: "UNCHANGED_HELD" as const, holdId: active.id };
    const hold = await tx.sellerOfferPriceAnomalyHold.create({ data: { sellerOfferId: input.sellerOfferId, sellerId: input.sellerId, triggerPriceVersion: input.expectedPriceVersion, activeKey, ...snapshot(evaluation) } });
    await tx.sellerOffer.update({ where: { id: input.sellerOfferId }, data: { priceAnomalyHeld: true } });
    return { action: "HELD" as const, holdId: hold.id };
  }
  if (!active || input.expectedPriceVersion <= active.triggerPriceVersion) return { action: "UNCHANGED" as const };
  await tx.sellerOfferPriceAnomalyRelease.create({ data: { holdId: active.id, sellerOfferId: input.sellerOfferId, releasePriceVersion: input.expectedPriceVersion, ...snapshot(evaluation) } });
  await tx.sellerOfferPriceAnomalyHold.update({ where: { id: active.id }, data: { activeKey: null } });
  await tx.sellerOffer.update({ where: { id: input.sellerOfferId }, data: { priceAnomalyHeld: false } });
  return { action: "RELEASED" as const, holdId: active.id };
}
