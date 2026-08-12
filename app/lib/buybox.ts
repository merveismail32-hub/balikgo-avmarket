export const BUYBOX_ALGORITHM_VERSION = "v1" as const;

export const BUYBOX_WEIGHTS = { price: 0.55, inventory: 0.15, handling: 0.1, sellerPerformance: 0.2 } as const;

export type BuyboxReasonCode = "CATALOG_INACTIVE" | "OFFER_INACTIVE" | "OUT_OF_STOCK" | "INVALID_PRICE" | "SELLER_INELIGIBLE" | "CATALOG_MISMATCH";
export type SellerPerformance = { successfulOrders: number; totalOrders: number };
export type BuyboxOfferInput = { id: string; catalogProductId: string; sellerId: string; price: number; stock: number; active: boolean; handlingTimeDays: number | null; sellerStatus: string; sellerPerformance?: SellerPerformance };
export type BuyboxCatalogInput = { id: string; active: boolean; moderationStatus: string };
export type BuyboxScoreBreakdown = { priceScore: number; inventoryScore: number; handlingScore: number; sellerPerformanceScore: number; sellerPerformanceConfidence: number; finalScore: number };
export type RankedBuyboxOffer<T extends BuyboxOfferInput> = T & { score: BuyboxScoreBreakdown };

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export function getOfferEligibility(catalog: BuyboxCatalogInput, offer: BuyboxOfferInput): BuyboxReasonCode[] {
  const reasons: BuyboxReasonCode[] = [];
  if (!catalog.active || catalog.moderationStatus !== "APPROVED") reasons.push("CATALOG_INACTIVE");
  if (offer.catalogProductId !== catalog.id) reasons.push("CATALOG_MISMATCH");
  if (!offer.active) reasons.push("OFFER_INACTIVE");
  if (offer.stock <= 0) reasons.push("OUT_OF_STOCK");
  if (!Number.isFinite(offer.price) || offer.price <= 0) reasons.push("INVALID_PRICE");
  if (offer.sellerStatus !== "APPROVED") reasons.push("SELLER_INELIGIBLE");
  return reasons;
}

function performanceScore(performance?: SellerPerformance) {
  const total = Math.max(0, performance?.totalOrders ?? 0);
  const successful = Math.min(total, Math.max(0, performance?.successfulOrders ?? 0));
  const priorSample = 10;
  const score = ((0.75 * priorSample + successful) / (priorSample + total)) * 100;
  return { score: clamp(score), confidence: total / (priorSample + total) };
}

export function scoreOffer<T extends BuyboxOfferInput>(offer: T, lowestPrice: number): RankedBuyboxOffer<T> {
  const priceScore = clamp((lowestPrice / offer.price) * 100);
  const inventoryScore = clamp((Math.log1p(offer.stock) / Math.log1p(20)) * 100);
  const handlingScore = offer.handlingTimeDays == null ? 60 : clamp(100 - Math.max(0, offer.handlingTimeDays) * 15);
  const performance = performanceScore(offer.sellerPerformance);
  const finalScore = priceScore * BUYBOX_WEIGHTS.price + inventoryScore * BUYBOX_WEIGHTS.inventory + handlingScore * BUYBOX_WEIGHTS.handling + performance.score * BUYBOX_WEIGHTS.sellerPerformance;
  return { ...offer, score: { priceScore: round(priceScore), inventoryScore: round(inventoryScore), handlingScore: round(handlingScore), sellerPerformanceScore: round(performance.score), sellerPerformanceConfidence: round(performance.confidence), finalScore: round(finalScore) } };
}

export function rankOffers<T extends BuyboxOfferInput>(catalog: BuyboxCatalogInput, offers: T[]) {
  const eligible = offers.filter((offer) => getOfferEligibility(catalog, offer).length === 0);
  if (!eligible.length) return [] as RankedBuyboxOffer<T>[];
  const lowestPrice = Math.min(...eligible.map((offer) => offer.price));
  return eligible.map((offer) => scoreOffer(offer, lowestPrice)).sort((a, b) => b.score.finalScore - a.score.finalScore || a.price - b.price || (a.handlingTimeDays ?? Number.MAX_SAFE_INTEGER) - (b.handlingTimeDays ?? Number.MAX_SAFE_INTEGER) || b.score.sellerPerformanceScore - a.score.sellerPerformanceScore || a.id.localeCompare(b.id));
}

export function resolveBuybox<T extends BuyboxOfferInput>(catalog: BuyboxCatalogInput, offers: T[]) {
  const ranked = rankOffers(catalog, offers);
  return { catalogProductId: catalog.id, winner: ranked[0] ?? null, alternatives: ranked.slice(1), algorithmVersion: BUYBOX_ALGORITHM_VERSION, evaluatedAt: new Date().toISOString() };
}

export function revalidateOffer(catalog: BuyboxCatalogInput, offer: BuyboxOfferInput, quantity = 1) {
  const reasons = getOfferEligibility(catalog, offer);
  if (quantity > offer.stock && !reasons.includes("OUT_OF_STOCK")) reasons.push("OUT_OF_STOCK");
  return { eligible: reasons.length === 0, reasons };
}
