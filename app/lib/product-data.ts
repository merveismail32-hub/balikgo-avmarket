import "server-only";

import type { Product as DatabaseProduct, SellerProfile } from "@prisma/client";
import { formatPrice, type Product } from "./products";
import { prisma } from "./prisma";
import { publicProductPolicy } from "./product-visibility";

export function toStoreProduct(product: DatabaseProduct & { seller?: SellerProfile }): Product {
  const price = Number(product.price);
  const oldPrice = product.oldPrice ? Number(product.oldPrice) : 0;

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: formatPrice(price),
    unitPrice: price,
    oldPrice: oldPrice ? formatPrice(oldPrice) : "",
    badge: product.badge,
    image: product.imageUrl,
    category: product.category,
    brand: product.brand,
    shortDescription: product.description,
    discount: product.discount,
    rating: product.rating,
    reviewCount: product.reviewCount,
    sellerName: product.seller?.storeName,
    storeSlug: product.seller?.storeSlug ?? undefined,
    images: Array.isArray(product.images) ? product.images.filter((value): value is string => typeof value === "string") : [product.imageUrl],
    stock: product.stock,
    technicalDetails: product.technicalDetails,
    shippingInfo: product.shippingInfo,
  };
}

export async function getCatalogProducts() {
  const databaseProducts = await prisma.product.findMany({
    where: { ...publicProductPolicy, stock: { gt: 0 } },
    orderBy: { createdAt: "asc" },
    include: { seller: true },
  });

  return databaseProducts.map(toStoreProduct);
}

export async function getCatalogProductsOrFallback() {
  try {
    return await getCatalogProducts();
  } catch {
    return [];
  }
}

export async function getCatalogProductByIdOrFallback(id: string) {
  try {
    const product = await prisma.product.findFirst({ where: { id, ...publicProductPolicy }, include: { seller: true } });
    return product ? toStoreProduct(product) : null;
  } catch {
    return null;
  }
}
