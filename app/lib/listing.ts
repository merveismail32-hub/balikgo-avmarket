import { Prisma } from "@prisma/client";
import { publicProductPolicy } from "./product-visibility";

export const PAGE_SIZE = 24;
export type ListingQuery = Record<string, string | string[] | undefined>;

function text(value: unknown, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function money(value: unknown) {
  if (value === "" || value === undefined) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 10_000_000
    ? amount
    : null;
}

export function parseListing(query: ListingQuery) {
  const minPrice = money(query.minPrice);
  const maxPrice = money(query.maxPrice);
  const invalidRange =
    minPrice !== null && maxPrice !== null && minPrice > maxPrice;
  const requestedSort = text(query.sort);

  return {
    q: text(query.q),
    category: text(query.category),
    brand: text(query.brand),
    minPrice: invalidRange ? null : minPrice,
    maxPrice: invalidRange ? null : maxPrice,
    inStock: query.inStock === "1" || query.inStock === "true",
    rating: [1, 2, 3, 4, 5].includes(Number(query.rating))
      ? Number(query.rating)
      : null,
    sort: ["price_asc", "price_desc", "newest", "rating_desc"].includes(
      requestedSort,
    )
      ? requestedSort
      : "recommended",
    page: Math.max(1, Math.floor(Number(query.page) || 1)),
  };
}

export function listingWhere(
  filters: ReturnType<typeof parseListing>,
  scope: Prisma.ProductWhereInput = {},
): Prisma.ProductWhereInput {
  return {
    ...publicProductPolicy,
    ...scope,
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" as const } },
            { brand: { contains: filters.q, mode: "insensitive" as const } },
            { category: { contains: filters.q, mode: "insensitive" as const } },
            { sku: { contains: filters.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(filters.category
      ? { categoryRecord: { slug: filters.category, active: true } }
      : {}),
    ...(filters.brand
      ? { brandRecord: { slug: filters.brand, active: true } }
      : {}),
    ...(filters.minPrice !== null || filters.maxPrice !== null
      ? {
          price: {
            ...(filters.minPrice !== null ? { gte: filters.minPrice } : {}),
            ...(filters.maxPrice !== null ? { lte: filters.maxPrice } : {}),
          },
        }
      : {}),
    ...(filters.inStock ? { stock: { gt: 0 } } : {}),
    ...(filters.rating ? { rating: { gte: filters.rating } } : {}),
  };
}

export function listingOrder(
  sort: string,
): Prisma.ProductOrderByWithRelationInput {
  if (sort === "price_asc") return { price: "asc" };
  if (sort === "price_desc") return { price: "desc" };
  if (sort === "newest") return { createdAt: "desc" };
  if (sort === "rating_desc") return { rating: "desc" };
  return { createdAt: "desc" };
}

export function queryHref(path: string, query: ListingQuery, page: number) {
  const params = new URLSearchParams();
  for (const key of [
    "q",
    "category",
    "brand",
    "minPrice",
    "maxPrice",
    "inStock",
    "rating",
    "sort",
  ]) {
    const value = query[key];
    if (typeof value === "string" && value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const value = params.toString();
  return value ? `${path}?${value}` : path;
}
