import type { Prisma } from "@prisma/client";

export async function ensureCatalogForProduct(tx: Prisma.TransactionClient, productId: string) {
  const product = await tx.product.findUnique({ where: { id: productId }, include: { sellerOffer: true } });
  if (!product) return null;
  if (product.catalogProductId && product.sellerOffer) return { catalogProductId: product.catalogProductId, sellerOfferId: product.sellerOffer.id };
  const identityKey = `legacy:${product.id}`;
  const catalog = product.catalogProductId
    ? await tx.catalogProduct.findUniqueOrThrow({ where: { id: product.catalogProductId } })
    : await tx.catalogProduct.upsert({
        where: { identityKey },
        update: {},
        create: { slug: product.slug, name: product.name, brand: product.brand, category: product.category, categoryId: product.categoryId, brandId: product.brandId, identityKey, description: product.description, imageUrl: product.imageUrl, images: product.images ?? undefined, technicalDetails: product.technicalDetails, shippingInfo: product.shippingInfo, badge: product.badge, rating: product.rating, reviewCount: product.reviewCount, active: product.active, moderationStatus: product.moderationStatus, moderationReason: product.moderationReason, moderatedAt: product.moderatedAt, createdAt: product.createdAt },
      });
  if (!product.catalogProductId) await tx.product.update({ where: { id: product.id }, data: { catalogProductId: catalog.id } });
  // A missing legacy offer is quarantined at zero stock. Product.stock is not an
  // inventory authority; guarded backfill/import tooling must establish offer stock.
  const offer = product.sellerOffer ?? await tx.sellerOffer.create({ data: { sellerId: product.sellerId, catalogProductId: catalog.id, legacyProductId: product.id, sellerSku: product.sku, price: product.price, listPrice: product.oldPrice, stock: 0, active: product.active, createdAt: product.createdAt } });
  return { catalogProductId: catalog.id, sellerOfferId: offer.id };
}
