import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Database connection is not configured.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const prefix = "QA-CATALOG-";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

async function cleanup() {
  const catalogs = await prisma.catalogProduct.findMany({ where: { identityKey: { startsWith: prefix } }, select: { id: true, legacyProducts: { select: { id: true } } } });
  const catalogIds = catalogs.map((entry) => entry.id); const productIds = catalogs.flatMap((entry) => entry.legacyProducts.map((product) => product.id));
  if (productIds.length) { await prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } }); await prisma.favorite.deleteMany({ where: { productId: { in: productIds } } }); }
  if (catalogIds.length) await prisma.sellerOffer.deleteMany({ where: { catalogProductId: { in: catalogIds } } });
  if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "qa-catalog-", endsWith: "@invalid.local" } } });
  if (catalogIds.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: catalogIds } } });
}

async function main() {
  await cleanup();
  try {
    const suffix = crypto.randomUUID().slice(0, 8); const passwordHash = `not-used-${suffix}`;
    const sellerA = await prisma.user.create({ data: { name: prefix + "Seller-A", surname: "Fixture", email: `qa-catalog-a-${suffix}@invalid.local`, phone: "000", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: prefix + "Store-A", storeSlug: `qa-catalog-a-${suffix}`, companyType: "QA", taxNumber: `A-${suffix}`, taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
    const sellerB = await prisma.user.create({ data: { name: prefix + "Seller-B", surname: "Fixture", email: `qa-catalog-b-${suffix}@invalid.local`, phone: "000", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: prefix + "Store-B", storeSlug: `qa-catalog-b-${suffix}`, companyType: "QA", taxNumber: `B-${suffix}`, taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
    const customer = await prisma.user.create({ data: { name: prefix + "Customer", surname: "Fixture", email: `qa-catalog-c-${suffix}@invalid.local`, phone: "000", passwordHash } });
    const catalog = await prisma.catalogProduct.create({ data: { slug: `qa-catalog-shared-${suffix}`, name: prefix + "Shared Rod 2500", brand: "QA", category: "QA", model: "Shared Rod", variantKey: "2500", barcode: `869${Date.now().toString().slice(-10)}`, identityKey: `${prefix}${suffix}:shared`, description: "QA shared catalog product", imageUrl: "/products/spin-olta-seti.jpg" } });
    const productA = await prisma.product.create({ data: { sellerId: sellerA.sellerProfile!.id, catalogProductId: catalog.id, name: catalog.name, slug: `qa-catalog-a-product-${suffix}`, category: "QA", brand: "QA", sku: `A-${suffix}`, price: 100, stock: 5, description: catalog.description, imageUrl: catalog.imageUrl } });
    const productB = await prisma.product.create({ data: { sellerId: sellerB.sellerProfile!.id, catalogProductId: catalog.id, name: catalog.name, slug: `qa-catalog-b-product-${suffix}`, category: "QA", brand: "QA", sku: `B-${suffix}`, price: 110, stock: 10, description: catalog.description, imageUrl: catalog.imageUrl } });
    const offerA = await prisma.sellerOffer.create({ data: { sellerId: sellerA.sellerProfile!.id, catalogProductId: catalog.id, legacyProductId: productA.id, sellerSku: productA.sku, price: 100, stock: 5 } });
    const offerB = await prisma.sellerOffer.create({ data: { sellerId: sellerB.sellerProfile!.id, catalogProductId: catalog.id, legacyProductId: productB.id, sellerSku: productB.sku, price: 110, stock: 10 } });
    assert(await prisma.catalogProduct.count({ where: { id: catalog.id } }) === 1 && await prisma.sellerOffer.count({ where: { catalogProductId: catalog.id } }) === 2, "One catalog / two offers invariant failed.");
    const blocked = await prisma.sellerOffer.updateMany({ where: { id: offerB.id, sellerId: sellerA.sellerProfile!.id }, data: { price: 1, stock: 1 } });
    assert(blocked.count === 0 && Number((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offerB.id } })).price) === 110, "SellerOffer IDOR scope failed.");
    await prisma.sellerOffer.updateMany({ where: { id: offerA.id, sellerId: sellerA.sellerProfile!.id }, data: { price: 90, stock: 0 } });
    const eligible = await prisma.sellerOffer.findFirst({ where: { catalogProductId: catalog.id, active: true, stock: { gt: 0 }, seller: { status: "APPROVED" } }, orderBy: { price: "asc" } });
    assert(eligible?.id === offerB.id && Number(eligible.price) === 110, "Out-of-stock offer entered eligible minimum.");
    let barcodeCollision = false; try { await prisma.catalogProduct.create({ data: { slug: `qa-catalog-collision-${suffix}`, name: "Collision", brand: "QA", category: "QA", barcode: catalog.barcode, identityKey: `${prefix}${suffix}:collision`, description: "QA collision check", imageUrl: catalog.imageUrl } }); } catch (error) { barcodeCollision = (error as { code?: string }).code === "P2002"; }
    assert(barcodeCollision, "Normalized barcode uniqueness failed.");
    const variant = await prisma.catalogProduct.create({ data: { slug: `qa-catalog-variant-${suffix}`, name: prefix + "Shared Rod 4000", brand: "QA", category: "QA", model: "Shared Rod", variantKey: "4000", identityKey: `${prefix}${suffix}:variant`, description: "Separate purchasable variant", imageUrl: catalog.imageUrl } });
    assert(variant.id !== catalog.id, "Variant collision merged distinct purchasable items.");
    await prisma.favorite.create({ data: { userId: customer.id, productId: productA.id, catalogProductId: catalog.id } });
    let favoriteDuplicate = false; try { await prisma.favorite.create({ data: { userId: customer.id, productId: productB.id, catalogProductId: catalog.id } }); } catch (error) { favoriteDuplicate = (error as { code?: string }).code === "P2002"; }
    assert(favoriteDuplicate, "Catalog-level favorite uniqueness failed.");
    await prisma.cartItem.create({ data: { userId: customer.id, productId: productB.id, catalogProductId: catalog.id, sellerOfferId: offerB.id, quantity: 2 } });
    assert(await prisma.cartItem.count({ where: { userId: customer.id, sellerOfferId: offerB.id, quantity: 2 } }) === 1, "Cart offer identity failed.");
    console.log("PASS: catalog identity, barcode/variant safety, multi-seller offers, eligibility, cart/favorite mapping and seller IDOR scope.");
  } finally { await cleanup(); await prisma.$disconnect(); }
}
main().catch((error) => { console.error("FAIL:", error instanceof Error ? error.message : error); process.exitCode = 1; });
