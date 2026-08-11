import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Veritabanı bağlantısı yapılandırılmamış.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
async function main() {
  const products = await prisma.product.findMany({ select: { id: true, name: true, sellerId: true, sku: true, seller: { select: { storeName: true } } } });
  const normalized = new Map<string, typeof products>();
  for (const product of products) { const sku = product.sku?.trim().toUpperCase(); if (sku) normalized.set(`${product.sellerId}:${sku}`, [...(normalized.get(`${product.sellerId}:${sku}`) ?? []), product]); }
  console.table({ total: products.length, nullSku: products.filter(p => p.sku === null).length, emptySku: products.filter(p => p.sku === "").length, whitespaceSku: products.filter(p => !!p.sku && !p.sku.trim()).length });
  console.table([...normalized.values()].filter(group => group.length > 1).flat().map(p => ({ productId: p.id, productName: p.name, sellerId: p.sellerId, storeName: p.seller.storeName, sku: p.sku })));
}
main().finally(() => prisma.$disconnect());
