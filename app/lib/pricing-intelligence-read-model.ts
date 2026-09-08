import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { getSellerPricingAnomalyEvaluation } from "./seller-pricing-anomaly";

type Client = PrismaClient | Prisma.TransactionClient;
export class PricingIntelligenceReadError extends Error {
  constructor(readonly code: "FORBIDDEN" | "OFFER_NOT_FOUND" | "INVALID_PAGE") { super(code); }
}

function limit(raw: unknown, fallback = 20) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 50) throw new PricingIntelligenceReadError("INVALID_PAGE");
  return value;
}
function offset(raw: unknown) {
  const value = raw === undefined ? 0 : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 500) throw new PricingIntelligenceReadError("INVALID_PAGE");
  return value;
}
function currentEvaluation(value: Awaited<ReturnType<typeof getSellerPricingAnomalyEvaluation>>, priceVersion: number) {
  if (!value) return null;
  return { priceVersion, status: value.status, confidence: value.confidence, reasonCodes: [...value.reasons], algorithmVersion: value.algorithmVersion, evaluatedAt: value.evaluatedAt, benchmark: { evidenceState: value.benchmark.evidenceState, comparableCount: value.benchmark.comparableCount, median: value.benchmark.medianPrice, signedDifference: value.benchmark.percentageDifference === null || value.benchmark.medianPrice === null ? null : new Prisma.Decimal(value.benchmark.targetPrice).minus(value.benchmark.medianPrice).toFixed(2), signedPercentageDifference: value.benchmark.percentageDifference } };
}
function safeAnomalyJson(raw: Prisma.JsonValue | null) {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return null;
  const value = raw as Prisma.JsonObject;
  return { status: typeof value.status === "string" ? value.status : null, confidence: typeof value.confidence === "string" ? value.confidence : null, algorithmVersion: typeof value.algorithmVersion === "string" ? value.algorithmVersion : null, evaluatedAt: typeof value.evaluatedAt === "string" ? value.evaluatedAt : null };
}
function attention(evaluation: ReturnType<typeof currentEvaluation>, held: boolean, recentAdmin: boolean) {
  return [...(held ? ["PRICE_ANOMALY_HELD"] : []), ...(evaluation?.status === "CRITICAL" ? ["CRITICAL_PRICE_ANOMALY"] : []), ...(evaluation?.status === "SUSPICIOUS" ? ["SUSPICIOUS_PRICE"] : []), ...(evaluation?.status === "INSUFFICIENT_EVIDENCE" ? ["INSUFFICIENT_PRICE_EVIDENCE"] : []), ...(recentAdmin ? ["RECENT_ADMIN_INTERVENTION"] : [])];
}
async function assertAdmin(actorUserId: string, client: Client) {
  if ((await client.user.findUnique({ where: { id: actorUserId }, select: { role: true } }))?.role !== "ADMIN") throw new PricingIntelligenceReadError("FORBIDDEN");
}

const offerReadSelect = {
  id: true, sellerId: true, catalogProductId: true, price: true, priceVersion: true, active: true, priceAnomalyHeld: true, stock: true, updatedAt: true,
  seller: { select: { storeName: true, storeSlug: true, status: true } },
  catalogProduct: { select: { name: true, active: true, moderationStatus: true } },
  priceObservations: { orderBy: [{ priceVersion: "desc" as const }, { id: "desc" as const }], take: 1, select: { id: true, previousAmount: true, amount: true, priceVersion: true, source: true, actorUserId: true, observedAt: true } },
  adminPriceInterventions: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 1, select: { id: true, actorUserId: true, actorRole: true, previousPrice: true, newPrice: true, previousPriceVersion: true, newPriceVersion: true, reason: true, previousHoldState: true, resultingHoldState: true, anomalyBefore: true, anomalyAfter: true, createdAt: true } },
  priceAnomalyHolds: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 1, select: { id: true, triggerPriceVersion: true, anomalyStatus: true, anomalyConfidence: true, reasonCodes: true, algorithmVersion: true, enforcementPolicyVersion: true, evaluatedAt: true, createdAt: true, activeKey: true, release: { select: { id: true, releasePriceVersion: true, anomalyStatus: true, anomalyConfidence: true, algorithmVersion: true, enforcementPolicyVersion: true, evaluatedAt: true, createdAt: true } } } },
} satisfies Prisma.SellerOfferSelect;

export async function getAdminPricingIntelligence(input: Readonly<{ actorUserId: string; limit?: unknown; cursor?: string; sellerId?: string; catalogProductId?: string; heldOnly?: boolean; recentInterventionOnly?: boolean; minPrice?: unknown; maxPrice?: unknown }>, client: Client = prisma) {
  await assertAdmin(input.actorUserId, client);
  const take = limit(input.limit);
  const price = input.minPrice !== undefined || input.maxPrice !== undefined ? { ...(input.minPrice !== undefined ? { gte: new Prisma.Decimal(input.minPrice as string) } : {}), ...(input.maxPrice !== undefined ? { lte: new Prisma.Decimal(input.maxPrice as string) } : {}) } : undefined;
  const rows = await client.sellerOffer.findMany({ where: { ...(input.sellerId ? { sellerId: input.sellerId } : {}), ...(input.catalogProductId ? { catalogProductId: input.catalogProductId } : {}), ...(input.heldOnly ? { priceAnomalyHeld: true } : {}), ...(input.recentInterventionOnly ? { adminPriceInterventions: { some: {} } } : {}), ...(price ? { price } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}), take: take + 1, select: offerReadSelect });
  const hasMore = rows.length > take;
  const items = await Promise.all(rows.slice(0, take).map(async (row) => {
    const evaluation = currentEvaluation(await getSellerPricingAnomalyEvaluation({ sellerId: row.sellerId, sellerOfferId: row.id }, client), row.priceVersion);
    const observation = row.priceObservations[0]; const intervention = row.adminPriceInterventions[0]; const hold = row.priceAnomalyHolds[0];
    return { sellerOffer: { id: row.id, sellerId: row.sellerId, catalogProductId: row.catalogProductId, currentPrice: row.price.toFixed(2), priceVersion: row.priceVersion, active: row.active, publicationEligible: row.active && !row.priceAnomalyHeld, priceAnomalyHeld: row.priceAnomalyHeld, stock: row.stock, updatedAt: row.updatedAt }, seller: row.seller, catalogProduct: row.catalogProduct, currentEvaluation: evaluation, latestPriceTransition: observation ? { id: observation.id, previousPrice: observation.previousAmount?.toFixed(2) ?? null, newPrice: observation.amount.toFixed(2), priceVersion: observation.priceVersion, source: observation.source, actorUserId: observation.actorUserId, timestamp: observation.observedAt } : null, latestIntervention: intervention ? { ...intervention, previousPrice: intervention.previousPrice.toFixed(2), newPrice: intervention.newPrice.toFixed(2), anomalyBefore: safeAnomalyJson(intervention.anomalyBefore), anomalyAfter: safeAnomalyJson(intervention.anomalyAfter) } : null, latestHold: hold ? { id: hold.id, active: hold.activeKey !== null, triggerPriceVersion: hold.triggerPriceVersion, anomalyStatus: hold.anomalyStatus, anomalyConfidence: hold.anomalyConfidence, reasonCodes: Array.isArray(hold.reasonCodes) ? hold.reasonCodes.filter((x): x is string => typeof x === "string") : [], algorithmVersion: hold.algorithmVersion, enforcementPolicyVersion: hold.enforcementPolicyVersion, evaluatedAt: hold.evaluatedAt, createdAt: hold.createdAt, release: hold.release } : null, attention: attention(evaluation, row.priceAnomalyHeld, Boolean(intervention)) };
  }));
  return { items, page: { limit: take, hasMore, nextCursor: hasMore ? items.at(-1)?.sellerOffer.id ?? null : null } };
}

export async function getAdminPricingTimeline(input: Readonly<{ actorUserId: string; sellerOfferId: string; limit?: unknown; offset?: unknown }>, client: Client = prisma) {
  await assertAdmin(input.actorUserId, client); const take = limit(input.limit); const skip = offset(input.offset);
  if (!await client.sellerOffer.findUnique({ where: { id: input.sellerOfferId }, select: { id: true } })) throw new PricingIntelligenceReadError("OFFER_NOT_FOUND");
  const bound = skip + take + 1;
  const [observations, interventions, holds] = await Promise.all([
    client.sellerOfferPriceObservation.findMany({ where: { sellerOfferId: input.sellerOfferId, source: { not: "ADMIN_PRICE_OVERRIDE" } }, orderBy: [{ observedAt: "desc" }, { id: "desc" }], take: bound, select: { id: true, previousAmount: true, amount: true, priceVersion: true, source: true, observedAt: true } }),
    client.adminPriceIntervention.findMany({ where: { sellerOfferId: input.sellerOfferId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: bound, select: { id: true, actorUserId: true, actorRole: true, previousPrice: true, newPrice: true, previousPriceVersion: true, newPriceVersion: true, reason: true, previousHoldState: true, resultingHoldState: true, anomalyBefore: true, anomalyAfter: true, createdAt: true } }),
    client.sellerOfferPriceAnomalyHold.findMany({ where: { sellerOfferId: input.sellerOfferId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: bound, select: { id: true, triggerPriceVersion: true, anomalyStatus: true, anomalyConfidence: true, reasonCodes: true, algorithmVersion: true, enforcementPolicyVersion: true, createdAt: true, release: { select: { id: true, releasePriceVersion: true, anomalyStatus: true, anomalyConfidence: true, algorithmVersion: true, enforcementPolicyVersion: true, createdAt: true } } } }),
  ]);
  const events = [...observations.map(x => ({ id: x.id, type: "PRICE_CHANGED" as const, timestamp: x.observedAt, priceVersion: x.priceVersion, previousPrice: x.previousAmount?.toFixed(2) ?? null, newPrice: x.amount.toFixed(2), source: x.source })), ...interventions.map(x => ({ id: x.id, type: "ADMIN_PRICE_OVERRIDE" as const, timestamp: x.createdAt, actorUserId: x.actorUserId, actorRole: x.actorRole, previousPrice: x.previousPrice.toFixed(2), newPrice: x.newPrice.toFixed(2), previousPriceVersion: x.previousPriceVersion, newPriceVersion: x.newPriceVersion, reason: x.reason, previousHoldState: x.previousHoldState, resultingHoldState: x.resultingHoldState, anomalyBefore: safeAnomalyJson(x.anomalyBefore), anomalyAfter: safeAnomalyJson(x.anomalyAfter) })), ...holds.flatMap(x => [{ id: x.id, type: "PRICE_ANOMALY_HOLD" as const, timestamp: x.createdAt, priceVersion: x.triggerPriceVersion, status: x.anomalyStatus, confidence: x.anomalyConfidence, reasonCodes: Array.isArray(x.reasonCodes) ? x.reasonCodes.filter((v): v is string => typeof v === "string") : [], algorithmVersion: x.algorithmVersion, enforcementPolicyVersion: x.enforcementPolicyVersion }, ...(x.release ? [{ id: x.release.id, type: "PRICE_ANOMALY_RELEASE" as const, timestamp: x.release.createdAt, priceVersion: x.release.releasePriceVersion, status: x.release.anomalyStatus, confidence: x.release.anomalyConfidence, algorithmVersion: x.release.algorithmVersion, enforcementPolicyVersion: x.release.enforcementPolicyVersion }] : [])])].sort((a,b)=>b.timestamp.getTime()-a.timestamp.getTime()||b.id.localeCompare(a.id));
  return { items: events.slice(skip, skip + take), page: { limit: take, offset: skip, hasMore: events.length > skip + take, nextOffset: events.length > skip + take ? skip + take : null } };
}

export async function getSellerPricingIntelligence(input: Readonly<{ actorUserId: string; sellerOfferId: string }>, client: Client = prisma) {
  const actor = await client.user.findUnique({ where: { id: input.actorUserId }, select: { role: true, sellerProfile: { select: { id: true } } } });
  if (actor?.role !== "SELLER" || !actor.sellerProfile) throw new PricingIntelligenceReadError("FORBIDDEN");
  const row = await client.sellerOffer.findFirst({ where: { id: input.sellerOfferId, sellerId: actor.sellerProfile.id }, select: offerReadSelect });
  if (!row) throw new PricingIntelligenceReadError("OFFER_NOT_FOUND");
  const evaluated = currentEvaluation(await getSellerPricingAnomalyEvaluation({ sellerId: row.sellerId, sellerOfferId: row.id }, client), row.priceVersion); const observation = row.priceObservations[0]; const intervention = row.adminPriceInterventions[0];
  const safeState = row.priceAnomalyHeld ? "PRICE_REVIEW_REQUIRED" : evaluated?.status === "INSUFFICIENT_EVIDENCE" ? "INSUFFICIENT_MARKET_EVIDENCE" : evaluated?.status === "NORMAL" ? "PRICE_WITHIN_EXPECTED_RANGE" : "PRICE_CORRECTION_AVAILABLE";
  return { offer: { id: row.id, product: { id: row.catalogProductId, title: row.catalogProduct.name }, currentPrice: row.price.toFixed(2), priceVersion: row.priceVersion, publicationAvailable: row.active && !row.priceAnomalyHeld, priceReviewHeld: row.priceAnomalyHeld, stock: row.stock }, pricingIntelligence: evaluated ? { status: evaluated.status, confidence: evaluated.confidence, benchmark: evaluated.benchmark } : null, attention: safeState, latestOwnPriceChange: observation ? { previousPrice: observation.previousAmount?.toFixed(2) ?? null, newPrice: observation.amount.toFixed(2), priceVersion: observation.priceVersion, source: observation.source === "ADMIN_PRICE_OVERRIDE" ? "PLATFORM_PRICE_ADJUSTMENT" : "SELLER_PRICE_CHANGE", timestamp: observation.observedAt } : null, platformIntervention: intervention ? { occurred: true, source: "PLATFORM_PRICE_ADJUSTMENT" as const, timestamp: intervention.createdAt } : null, correction: { allowed: true, expectedPriceVersion: row.priceVersion, revalidationRequired: row.priceAnomalyHeld } };
}
