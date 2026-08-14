import "dotenv/config";
import { ensureCatalogForProduct } from "../app/lib/catalog-sync";
import { createGuardedOperationPrisma } from "./guarded-operation-prisma";

const prisma = createGuardedOperationPrisma("catalog-backfill", "write");

async function main() {
  const ids = await prisma.product.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  for (const { id } of ids) await prisma.$transaction((tx) => ensureCatalogForProduct(tx, id));
  const products = await prisma.product.findMany({ where: { catalogProductId: { not: null }, sellerOffer: { isNot: null } }, select: { id: true, catalogProductId: true, sellerOffer: { select: { id: true } } } });
  const mapping = new Map(products.map((product) => [product.id, { catalogProductId: product.catalogProductId!, sellerOfferId: product.sellerOffer!.id }]));
  for (const item of await prisma.cartItem.findMany({ where: { OR: [{ catalogProductId: null }, { sellerOfferId: null }] }, select: { id: true, productId: true } })) { const target = mapping.get(item.productId); if (target) await prisma.cartItem.update({ where: { id: item.id }, data: target }); }
  for (const item of await prisma.orderItem.findMany({ where: { OR: [{ catalogProductId: null }, { sellerOfferId: null }] }, select: { id: true, productId: true } })) { const target = mapping.get(item.productId); if (target) await prisma.orderItem.update({ where: { id: item.id }, data: target }); }
  let reviewNeededCount = 0;
  for (const favorite of await prisma.favorite.findMany({ where: { catalogProductId: null }, select: { id: true, userId: true, productId: true } })) { const target = mapping.get(favorite.productId); if (!target) continue; if (await prisma.favorite.count({ where: { userId: favorite.userId, catalogProductId: target.catalogProductId } })) reviewNeededCount += 1; else await prisma.favorite.update({ where: { id: favorite.id }, data: { catalogProductId: target.catalogProductId } }); }
  for (const review of await prisma.review.findMany({ where: { catalogProductId: null }, select: { id: true, userId: true, productId: true } })) { const target = mapping.get(review.productId); if (!target) continue; if (await prisma.review.count({ where: { userId: review.userId, catalogProductId: target.catalogProductId } })) reviewNeededCount += 1; else await prisma.review.update({ where: { id: review.id }, data: { catalogProductId: target.catalogProductId } }); }
  const [productCount, catalogProductCount, sellerOfferCount, unmappedCount, skuMismatch, priceMismatch, stockMismatch, sellerMismatch, cartUnmapped, favoriteUnmapped, reviewUnmapped, orderItemUnmapped] = await Promise.all([
    prisma.product.count(), prisma.catalogProduct.count(), prisma.sellerOffer.count(), prisma.product.count({ where: { OR: [{ catalogProductId: null }, { sellerOffer: null }] } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "SellerOffer" o JOIN "Product" p ON p.id=o."legacyProductId" WHERE o."sellerSku" IS DISTINCT FROM p.sku`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "SellerOffer" o JOIN "Product" p ON p.id=o."legacyProductId" WHERE o.price<>p.price`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "SellerOffer" o JOIN "Product" p ON p.id=o."legacyProductId" WHERE o.stock<>p.stock`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "SellerOffer" o JOIN "Product" p ON p.id=o."legacyProductId" WHERE o."sellerId"<>p."sellerId"`,
    prisma.cartItem.count({ where: { OR: [{ catalogProductId: null }, { sellerOfferId: null }] } }), prisma.favorite.count({ where: { catalogProductId: null } }), prisma.review.count({ where: { catalogProductId: null } }), prisma.orderItem.count({ where: { OR: [{ catalogProductId: null }, { sellerOfferId: null }] } }),
  ]);
  console.log(JSON.stringify({ productCount, catalogProductCount, sellerOfferCount, unmappedCount, cartUnmapped, favoriteUnmapped, reviewUnmapped, orderItemUnmapped, reviewNeededCount, skuMismatch: Number(skuMismatch[0]?.count ?? -1), priceMismatch: Number(priceMismatch[0]?.count ?? -1), stockMismatch: Number(stockMismatch[0]?.count ?? -1), sellerMismatch: Number(sellerMismatch[0]?.count ?? -1) }));
}
main().finally(() => prisma.$disconnect());
