import "server-only";

import { Prisma } from "@prisma/client";
import { enforcePriceAnomalyPublication } from "./price-anomaly-publication";

export type SellerOfferPriceSource = "SELLER_PRODUCT_CREATE" | "SELLER_PRODUCT_PATCH" | "SELLER_INVENTORY" | "LEGACY_CATALOG_SYNC" | "ADMIN_PRICE_OVERRIDE";

export class SellerOfferPriceError extends Error {
  constructor(readonly code: "OFFER_NOT_FOUND" | "STALE_PRICE_VERSION" | "INVALID_PRICE") {
    super(code);
  }
}

function canonicalPrice(value: unknown) {
  let price: Prisma.Decimal;
  const normalized = typeof value === "object" && value !== null ? String(value) : value;
  try { price = new Prisma.Decimal(normalized as string | number | Prisma.Decimal).toDecimalPlaces(2); }
  catch { throw new SellerOfferPriceError("INVALID_PRICE"); }
  if (price.lessThanOrEqualTo(0) || price.greaterThan("9999999999.99")) throw new SellerOfferPriceError("INVALID_PRICE");
  return price;
}

export async function createSellerOfferWithPriceEvidence(
  tx: Prisma.TransactionClient,
  input: { data: Prisma.SellerOfferUncheckedCreateInput; source: SellerOfferPriceSource; actorUserId?: string | null },
) {
  const price = canonicalPrice(input.data.price);
  const offer = await tx.sellerOffer.create({ data: { ...input.data, price, priceVersion: 1 } });
  await tx.sellerOfferPriceObservation.create({ data: { sellerOfferId: offer.id, catalogProductId: offer.catalogProductId, sellerId: offer.sellerId, amount: price, priceVersion: 1, source: input.source, actorUserId: input.actorUserId ?? null } });
  await enforcePriceAnomalyPublication(tx, { sellerOfferId: offer.id, sellerId: offer.sellerId, expectedPriceVersion: 1 });
  return offer;
}

export async function setSellerOfferPrice(
  tx: Prisma.TransactionClient,
  input: { sellerOfferId: string; sellerId: string; productId: string | null; expectedPriceVersion: number; price: Prisma.Decimal.Value; source: SellerOfferPriceSource; actorUserId: string },
) {
  const price = canonicalPrice(input.price);
  const current = await tx.sellerOffer.findFirst({ where: { id: input.sellerOfferId, sellerId: input.sellerId, ...(input.productId ? { legacyProductId: input.productId } : {}) }, select: { id: true, catalogProductId: true, legacyProductId: true, price: true, priceVersion: true } });
  if (!current) throw new SellerOfferPriceError("OFFER_NOT_FOUND");
  if (current.priceVersion !== input.expectedPriceVersion) throw new SellerOfferPriceError("STALE_PRICE_VERSION");
  if (current.price.equals(price)) return { changed: false as const, price: current.price, priceVersion: current.priceVersion };

  const changed = await tx.sellerOffer.updateMany({ where: { id: current.id, sellerId: input.sellerId, priceVersion: input.expectedPriceVersion }, data: { price, priceVersion: { increment: 1 } } });
  if (changed.count !== 1) throw new SellerOfferPriceError("STALE_PRICE_VERSION");
  const priceVersion = input.expectedPriceVersion + 1;
  if (current.legacyProductId) await tx.product.update({ where: { id: current.legacyProductId }, data: { price } });
  await tx.sellerOfferPriceObservation.create({ data: { sellerOfferId: current.id, catalogProductId: current.catalogProductId, sellerId: input.sellerId, previousAmount: current.price, amount: price, priceVersion, source: input.source, actorUserId: input.actorUserId } });
  await enforcePriceAnomalyPublication(tx, { sellerOfferId: current.id, sellerId: input.sellerId, expectedPriceVersion: priceVersion });
  return { changed: true as const, price, priceVersion };
}
