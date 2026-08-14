import "server-only";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { decideCatalogMatch, normalizeCatalogText, parseGtin } from "../app/lib/catalog-intelligence";
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
async function verifyCleanup() {
  const ids = (values: string[]) => ({ id: { in: values } });
  const remaining = await Promise.all([
    f.reviews.length ? prisma.catalogMatchReview.count({ where: ids(f.reviews) }) : 0,
    f.offers.length ? prisma.sellerOffer.count({ where: ids(f.offers) }) : 0,
    f.products.length ? prisma.product.count({ where: ids(f.products) }) : 0,
    f.catalogs.length ? prisma.catalogProduct.count({ where: ids(f.catalogs) }) : 0,
    f.sellers.length ? prisma.sellerProfile.count({ where: ids(f.sellers) }) : 0,
    f.users.length ? prisma.user.count({ where: ids(f.users) }) : 0,
  ]);
  assert(remaining.every((count) => count === 0), "EXACT_ID_CLEANUP_FAILED");
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
    const existingOffer = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: f.offers[0] }, include: { catalogProduct: { select: { normalizedGtin: true, barcode: true } } } });
    const foreignOfferBefore = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: f.offers[1] } });
    const beforeConflict = { catalogProductId: existingOffer.catalogProductId, price: existingOffer.price.toString(), stock: existingOffer.stock, active: existingOffer.active, sellerSku: existingOffer.sellerSku, matchStatus: existingOffer.matchStatus, matchReason: existingOffer.matchReason, matchConfidence: existingOffer.matchConfidence?.toString() ?? null };
    const newGtin = parseGtin("036000291452");
    const conflict = decideCatalogMatch({ gtin: newGtin, sellerSku: existingOffer.sellerSku, normalizedName: normalizeCatalogText(catalog.name), normalizedBrand: normalizeCatalogText(catalog.brand), normalizedModel: catalog.normalizedModel, candidates: [], sellerSkuOffer: existingOffer });
    assert(conflict.type === "CONFLICT" && conflict.reason === "SKU_GTIN_CONFLICT" && conflict.catalogProductId === null, "NEW_GTIN_SKU_CONFLICT_FAILED");
    const review = await prisma.catalogMatchReview.create({ data: { sellerId: a.id, candidateCatalogProductId: conflict.candidateIds[0] ?? null, sellerSku: existingOffer.sellerSku, proposedGtin: newGtin.valid ? newGtin.normalized : null, normalizedName: catalog.normalizedName, normalizedBrand: catalog.normalizedBrand, normalizedModel: catalog.normalizedModel, matchStatus: conflict.type, reasonCode: conflict.reason, confidence: conflict.confidence } }); f.reviews.push(review.id);
    const afterConflict = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: existingOffer.id } });
    const foreignOfferAfter = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: f.offers[1] } });
    assert(JSON.stringify(beforeConflict) === JSON.stringify({ catalogProductId: afterConflict.catalogProductId, price: afterConflict.price.toString(), stock: afterConflict.stock, active: afterConflict.active, sellerSku: afterConflict.sellerSku, matchStatus: afterConflict.matchStatus, matchReason: afterConflict.matchReason, matchConfidence: afterConflict.matchConfidence?.toString() ?? null }), "CONFLICT_MUTATED_EXISTING_OFFER");
    assert(foreignOfferBefore.updatedAt.getTime() === foreignOfferAfter.updatedAt.getTime(), "CONFLICT_MUTATED_FOREIGN_SELLER_OFFER");
    const otherCatalog = await prisma.catalogProduct.create({ data: { slug: `ci-other-${key}`, identityKey: `ci-other-${key}`, name: "Other", brand: "QA", category: "QA", normalizedGtin: newGtin.valid ? newGtin.normalized : null, description: "QA", imageUrl: "/qa" } }); f.catalogs.push(otherCatalog.id);
    const knownConflict = decideCatalogMatch({ gtin: newGtin, sellerSku: existingOffer.sellerSku, normalizedName: "other", normalizedBrand: "qa", normalizedModel: null, candidates: [{ id: otherCatalog.id, normalizedGtin: otherCatalog.normalizedGtin, normalizedName: null, normalizedBrand: null, normalizedModel: null }], sellerSkuOffer: existingOffer });
    assert(knownConflict.type === "CONFLICT" && knownConflict.reason === "SKU_GTIN_CONFLICT" && knownConflict.catalogProductId === null, "KNOWN_GTIN_SKU_CONFLICT_FAILED");
    console.log("PASS: seller-SKU GTIN conflicts create review without mutating own or foreign offers");
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
  } finally { await cleanup(); await verifyCleanup(); console.log("PASS: exact-ID fixture cleanup removed every created row"); await prisma.$disconnect(); }
}
void main();
