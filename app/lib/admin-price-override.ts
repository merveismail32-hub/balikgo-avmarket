import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { setSellerOfferPrice, SellerOfferPriceError } from "./seller-offer-price";
import { getSellerPricingAnomalyEvaluation } from "./seller-pricing-anomaly";

type Client = Pick<PrismaClient, "$transaction">;
export type AdminPriceOverrideErrorCode = "FORBIDDEN" | "OFFER_NOT_FOUND" | "INVALID_REASON" | "STALE_PRICE_VERSION" | "INVALID_PRICE";
export class AdminPriceOverrideError extends Error { constructor(readonly code: AdminPriceOverrideErrorCode) { super(code); } }

function reason(value: string) {
  const normalized = value.trim();
  if (normalized.length < 3 || normalized.length > 500) throw new AdminPriceOverrideError("INVALID_REASON");
  return normalized;
}
function anomalySummary(value: Awaited<ReturnType<typeof getSellerPricingAnomalyEvaluation>>): Prisma.InputJsonObject | undefined {
  if (!value) return undefined;
  return { status: value.status, confidence: value.confidence, reasons: [...value.reasons], algorithmVersion: value.algorithmVersion, evaluatedAt: value.evaluatedAt };
}

export async function overrideSellerOfferPriceByAdmin(input: Readonly<{ actorUserId: string; sellerOfferId: string; expectedPriceVersion: number; price: Prisma.Decimal.Value; reason: string }>, client: Client = prisma) {
  const auditReason = reason(input.reason);
  try {
    return await client.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorUserId }, select: { role: true } });
    if (actor?.role !== "ADMIN") throw new AdminPriceOverrideError("FORBIDDEN");
    const before = await tx.sellerOffer.findUnique({ where: { id: input.sellerOfferId }, select: { id: true, sellerId: true, catalogProductId: true, legacyProductId: true, price: true, priceVersion: true, priceAnomalyHeld: true } });
    if (!before) throw new AdminPriceOverrideError("OFFER_NOT_FOUND");
    if (before.priceVersion !== input.expectedPriceVersion) throw new AdminPriceOverrideError("STALE_PRICE_VERSION");
    const anomalyBefore = await getSellerPricingAnomalyEvaluation({ sellerId: before.sellerId, sellerOfferId: before.id }, tx);
    let changed;
    try {
      changed = await setSellerOfferPrice(tx, { sellerOfferId: before.id, sellerId: before.sellerId, productId: before.legacyProductId, expectedPriceVersion: input.expectedPriceVersion, price: input.price, source: "ADMIN_PRICE_OVERRIDE", actorUserId: input.actorUserId });
    } catch (error) {
      if (error instanceof SellerOfferPriceError) throw new AdminPriceOverrideError(error.code);
      throw error;
    }
    if (!changed.changed) return { changed: false as const, price: changed.price, priceVersion: changed.priceVersion, priceAnomalyHeld: before.priceAnomalyHeld, auditId: null };
    const after = await tx.sellerOffer.findUniqueOrThrow({ where: { id: before.id }, select: { price: true, priceVersion: true, priceAnomalyHeld: true } });
    const anomalyAfter = await getSellerPricingAnomalyEvaluation({ sellerId: before.sellerId, sellerOfferId: before.id }, tx);
    const audit = await tx.adminPriceIntervention.create({ data: { actorUserId: input.actorUserId, actorRole: "ADMIN", sellerOfferId: before.id, sellerId: before.sellerId, catalogProductId: before.catalogProductId, previousPrice: before.price, newPrice: after.price, previousPriceVersion: before.priceVersion, newPriceVersion: after.priceVersion, reason: auditReason, previousHoldState: before.priceAnomalyHeld, resultingHoldState: after.priceAnomalyHeld, anomalyBefore: anomalySummary(anomalyBefore), anomalyAfter: anomalySummary(anomalyAfter) } });
    return { changed: true as const, price: after.price, priceVersion: after.priceVersion, priceAnomalyHeld: after.priceAnomalyHeld, auditId: audit.id, anomaly: anomalyAfter ? { status: anomalyAfter.status, confidence: anomalyAfter.confidence } : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof AdminPriceOverrideError) throw error;
    if ((error as { code?: string }).code === "P2034") throw new AdminPriceOverrideError("STALE_PRICE_VERSION");
    throw error;
  }
}
