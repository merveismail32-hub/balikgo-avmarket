import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { formatPrice, type Product } from "./products";

export const publicCatalogPolicy: Prisma.CatalogProductWhereInput = {
  active: true,
  moderationStatus: "APPROVED",
  AND: [
    { OR: [{ categoryId: null }, { categoryRecord: { active: true } }] },
    { OR: [{ brandId: null }, { brandRecord: { active: true } }] },
  ],
  offers: { some: { active: true, seller: { status: "APPROVED" } } },
};

export const eligibleOfferPolicy: Prisma.SellerOfferWhereInput = {
  active: true,
  stock: { gt: 0 },
  seller: { status: "APPROVED" },
  catalogProduct: { active: true, moderationStatus: "APPROVED" },
};

export function isOfferEligible(input: { active: boolean; stock: number; seller: { status: string }; catalogProduct?: { active: boolean; moderationStatus: string } }) {
  return input.active && input.stock > 0 && input.seller.status === "APPROVED" && (!input.catalogProduct || (input.catalogProduct.active && input.catalogProduct.moderationStatus === "APPROVED"));
}

const catalogInclude = {
  categoryRecord: true,
  brandRecord: true,
  offers: {
    where: { active: true, seller: { status: "APPROVED" } },
    include: { seller: true, legacyProduct: true },
    orderBy: [{ price: "asc" as const }, { createdAt: "asc" as const }],
  },
} satisfies Prisma.CatalogProductInclude;

export type PublicCatalogRow = Prisma.CatalogProductGetPayload<{ include: typeof catalogInclude }>;

export function toStoreCatalogProduct(row: PublicCatalogRow): Product | null {
  const eligible = row.offers.filter((offer) => offer.stock > 0 && offer.legacyProduct);
  const selected = eligible[0] ?? row.offers.find((offer) => offer.legacyProduct);
  if (!selected?.legacyProduct) return null;
  const price = Number(selected.price);
  const listPrice = selected.listPrice ? Number(selected.listPrice) : 0;
  return {
    id: selected.legacyProduct.id,
    catalogProductId: row.id,
    sellerOfferId: selected.id,
    slug: row.slug,
    name: row.name,
    price: `${formatPrice(price)}${eligible.length > 1 ? "'den başlayan" : ""}`,
    unitPrice: price,
    oldPrice: listPrice ? formatPrice(listPrice) : "",
    badge: row.badge,
    image: row.imageUrl,
    category: row.category,
    brand: row.brand,
    shortDescription: row.description,
    discount: listPrice > price ? Math.round(((listPrice - price) / listPrice) * 100) : 0,
    rating: row.rating,
    reviewCount: row.reviewCount,
    sellerName: selected.seller.storeName,
    storeSlug: selected.seller.storeSlug ?? undefined,
    images: Array.isArray(row.images) ? row.images.filter((value): value is string => typeof value === "string") : [row.imageUrl],
    stock: selected.stock,
    technicalDetails: row.technicalDetails,
    shippingInfo: row.shippingInfo,
    offerCount: row.offers.length,
  };
}

export async function findPublicCatalogBySlug(slug: string) {
  return prisma.catalogProduct.findFirst({ where: { slug, ...publicCatalogPolicy }, include: catalogInclude });
}

export async function findPublicCatalogByAnyId(id: string) {
  return prisma.catalogProduct.findFirst({ where: { ...publicCatalogPolicy, OR: [{ id }, { legacyProducts: { some: { id } } }] }, include: catalogInclude });
}

export type CatalogListFilters = {
  q?: string; categoryId?: string | { in: string[] }; brandId?: string; categorySlug?: string; brandSlug?: string;
  minPrice?: number | null; maxPrice?: number | null; inStock?: boolean; rating?: number | null; sort?: string; skip?: number; take?: number;
};

export async function listPublicCatalog(input: CatalogListFilters = {}) {
  const offerPrice = input.minPrice != null || input.maxPrice != null ? { price: { ...(input.minPrice != null ? { gte: input.minPrice } : {}), ...(input.maxPrice != null ? { lte: input.maxPrice } : {}) } } : {};
  const where: Prisma.CatalogProductWhereInput = {
    ...publicCatalogPolicy,
    ...(input.categoryId ? { categoryId: typeof input.categoryId === "string" ? input.categoryId : input.categoryId } : {}),
    ...(input.brandId ? { brandId: input.brandId } : {}),
    ...(input.categorySlug ? { categoryRecord: { slug: input.categorySlug, active: true } } : {}),
    ...(input.brandSlug ? { brandRecord: { slug: input.brandSlug, active: true } } : {}),
    ...(input.rating ? { rating: { gte: input.rating } } : {}),
    ...(input.q ? { OR: [
      { name: { contains: input.q, mode: "insensitive" } }, { brand: { contains: input.q, mode: "insensitive" } },
      { category: { contains: input.q, mode: "insensitive" } }, { model: { contains: input.q, mode: "insensitive" } },
      { barcode: { contains: input.q } }, { offers: { some: { sellerSku: { contains: input.q, mode: "insensitive" } } } },
    ] } : {}),
    ...((input.inStock || Object.keys(offerPrice).length) ? { offers: { some: { active: true, seller: { status: "APPROVED" }, ...(input.inStock ? { stock: { gt: 0 } } : {}), ...offerPrice } } } : {}),
  };
  const priceSort = input.sort === "price_asc" || input.sort === "price_desc";
  const skip = input.skip ?? 0; const take = input.take ?? 2_147_483_647;
  const [rows, databaseTotal] = priceSort
    ? [await prisma.catalogProduct.findMany({ where, include: catalogInclude, orderBy: { createdAt: "desc" } }), await prisma.catalogProduct.count({ where })]
    : await Promise.all([prisma.catalogProduct.findMany({ where, include: catalogInclude, orderBy: input.sort === "rating_desc" ? { rating: "desc" } : { createdAt: "desc" }, skip, take }), prisma.catalogProduct.count({ where })]);
  const products = rows.map(toStoreCatalogProduct).filter((value): value is Product => Boolean(value));
  if (input.sort === "price_asc") products.sort((a, b) => a.unitPrice - b.unitPrice);
  if (input.sort === "price_desc") products.sort((a, b) => b.unitPrice - a.unitPrice);
  return { products: priceSort ? products.slice(skip, skip + take) : products, total: databaseTotal };
}
