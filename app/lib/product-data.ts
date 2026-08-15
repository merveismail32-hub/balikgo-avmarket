import "server-only";

import type { Product as DatabaseProduct, SellerProfile } from "@prisma/client";
import { formatPrice, type Product } from "./products";
import { findPublicCatalogByAnyId, listPublicCatalog, toStoreCatalogProduct } from "./catalog-data";

export function toStoreProduct(product: (DatabaseProduct & { seller?: SellerProfile }) | Product, offerStock?: number): Product {
  if ("unitPrice" in product) return product;
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
    stock: offerStock ?? 0,
    technicalDetails: product.technicalDetails,
    shippingInfo: product.shippingInfo,
  };
}

export async function getCatalogProducts() {
  return (await listPublicCatalog({ inStock: true })).products;
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
    const product = await findPublicCatalogByAnyId(id);
    return product ? toStoreCatalogProduct(product) : null;
  } catch {
    return null;
  }
}
