import "server-only";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { guardedTestConnectionOptions } from "./guarded-test-prisma";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const connection = guardedTestConnectionOptions();
const prisma = new PrismaClient({ adapter: new PrismaPg(connection), transactionOptions: { maxWait: 10_000, timeout: 30_000 } });
type Fixture = { users: string[]; sellers: string[]; catalogs: string[]; products: string[]; offers: string[]; reviews: string[] };
const f: Fixture = { users: [], sellers: [], catalogs: [], products: [], offers: [], reviews: [] };
async function cleanup() {
  const ids = (values: string[]) => ({ id: { in: values } });
  if (f.reviews.length) await prisma.catalogMatchReview.deleteMany({ where: ids(f.reviews) });
  if (f.offers.length) await prisma.sellerOffer.deleteMany({ where: ids(f.offers) });
  if (f.products.length) await prisma.product.deleteMany({ where: ids(f.products) });
  if (f.catalogs.length) await prisma.catalogProduct.deleteMany({ where: ids(f.catalogs) });
  if (f.sellers.length) await prisma.sellerProfile.deleteMany({ where: ids(f.sellers) });
  if (f.users.length) await prisma.user.deleteMany({ where: ids(f.users) });
}
async function seller(label: string) {
  const key = randomUUID();
  const user = await prisma.user.create({ data: { name: "CI", surname: label, email: `ci-${key}@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER", sellerProfile: { create: { storeName: `CI-${key}`, storeSlug: `ci-${key}`, companyType: "QA", taxNumber: key, taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
  f.users.push(user.id); f.sellers.push(user.sellerProfile!.id); return user.sellerProfile!;
}
async function main() {
  await cleanup();
  try {
    const identity = await prisma.$queryRaw<Array<{ database: string; role: string }>>`select current_database() as database, current_user as role`;
    assert(identity[0]?.database === "postgres" && identity[0]?.role === "postgres", "SERVER_IDENTITY_MISMATCH");
    console.log("PASS: guarded TEST identity, official CA and authentication");
    const a = await seller("A"), b = await seller("B");
    const key = randomUUID();
    const catalog = await prisma.catalogProduct.create({ data: { slug: `ci-${key}`, identityKey: `ci-${key}`, name: "Shimano Test", brand: "Shimano", category: "QA", normalizedGtin: "4006381333931", normalizedName: "shimano test", normalizedBrand: "shimano", normalizedModel: "x1", description: "QA", imageUrl: "/qa" } }); f.catalogs.push(catalog.id);
    for (const [index, owner] of [a, b].entries()) {
      const product = await prisma.product.create({ data: { sellerId: owner.id, catalogProductId: catalog.id, name: catalog.name, slug: `ci-p-${index}-${key}`, category: "QA", brand: "Shimano", sku: "SHARED-SKU", price: 100 + index, stock: 2, description: "QA", imageUrl: "/qa" } }); f.products.push(product.id);
      const offer = await prisma.sellerOffer.create({ data: { sellerId: owner.id, catalogProductId: catalog.id, legacyProductId: product.id, sellerSku: "SHARED-SKU", price: 100 + index, stock: 2, matchStatus: "EXACT_GTIN_MATCH", matchReason: "GTIN_EXACT", matchConfidence: 1 } }); f.offers.push(offer.id);
    }
    assert(await prisma.catalogProduct.count({ where: { normalizedGtin: "4006381333931" } }) === 1 && await prisma.sellerOffer.count({ where: { catalogProductId: catalog.id } }) === 2, "MULTI_SELLER_CATALOG_INVARIANT_FAILED");
    console.log("PASS: exact GTIN single catalog, two sellers and seller-scoped SKU");
    const foreign = await prisma.sellerOffer.updateMany({ where: { id: f.offers[1], sellerId: a.id }, data: { price: 1 } });
    assert(foreign.count === 0, "SELLER_OFFER_IDOR_FAILED"); console.log("PASS: seller offer IDOR isolation");
    const raceGtin = "10012345678902";
    const createRace = (suffix: string) => prisma.$transaction(async (tx) => tx.catalogProduct.create({ data: { slug: `ci-race-${suffix}-${key}`, identityKey: `ci-race-${suffix}-${key}`, name: "Race", brand: "QA", category: "QA", normalizedGtin: raceGtin, description: "QA", imageUrl: "/qa" } }));
    const raced = await Promise.allSettled([createRace("a"), createRace("b")]);
    for (const result of raced) if (result.status === "fulfilled") f.catalogs.push(result.value.id);
    assert(raced.filter((result) => result.status === "fulfilled").length === 1 && await prisma.catalogProduct.count({ where: { normalizedGtin: raceGtin } }) === 1, "CONCURRENT_GTIN_DEDUPE_FAILED");
    console.log("PASS: concurrent exact-GTIN create leaves one catalog row");
    const before = await prisma.catalogProduct.count();
    const rollbackKey = randomUUID();
    await prisma.$transaction(async (tx) => { await tx.catalogProduct.create({ data: { id: rollbackKey, slug: rollbackKey, identityKey: rollbackKey, name: "Rollback", brand: "QA", category: "QA", description: "QA", imageUrl: "/qa" } }); throw new Error("FORCED_ROLLBACK"); }).catch((error) => assert(error instanceof Error && error.message === "FORCED_ROLLBACK", "UNEXPECTED_ROLLBACK_ERROR"));
    assert(await prisma.catalogProduct.count() === before && await prisma.catalogProduct.count({ where: { id: rollbackKey } }) === 0, "ATOMIC_ROLLBACK_FAILED");
    console.log("PASS: transaction rollback leaves no partial catalog/offer state");
  } finally { await cleanup(); await prisma.$disconnect(); }
}
void main();
