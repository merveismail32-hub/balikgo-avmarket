import "server-only";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { closeCatalogMatchReviewData, createOrGetOpenCatalogMatchReview, type CatalogReviewCreateInput } from "../app/lib/catalog-match-review";
import { guardedTestConnectionOptions } from "./guarded-test-prisma";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const prisma = new PrismaClient({ adapter: new PrismaPg(guardedTestConnectionOptions()), transactionOptions: { maxWait: 10_000, timeout: 30_000 } });
const fixture = { users: [] as string[], sellers: [] as string[], catalogs: [] as string[], offers: [] as string[], reviews: [] as string[] };
const rememberReview = <T extends { review: { id: string } }>(result: T) => { fixture.reviews.push(result.review.id); return result; };

async function cleanup() {
  const ids = (values: string[]) => ({ id: { in: [...new Set(values)] } });
  if (fixture.reviews.length) await prisma.catalogMatchReview.deleteMany({ where: ids(fixture.reviews) });
  if (fixture.offers.length) await prisma.sellerOffer.deleteMany({ where: ids(fixture.offers) });
  if (fixture.catalogs.length) await prisma.catalogProduct.deleteMany({ where: ids(fixture.catalogs) });
  if (fixture.sellers.length) await prisma.sellerProfile.deleteMany({ where: ids(fixture.sellers) });
  if (fixture.users.length) await prisma.user.deleteMany({ where: ids(fixture.users) });
}

async function verifyCleanup() {
  const ids = (values: string[]) => ({ id: { in: [...new Set(values)] } });
  const counts = await Promise.all([
    fixture.reviews.length ? prisma.catalogMatchReview.count({ where: ids(fixture.reviews) }) : 0,
    fixture.offers.length ? prisma.sellerOffer.count({ where: ids(fixture.offers) }) : 0,
    fixture.catalogs.length ? prisma.catalogProduct.count({ where: ids(fixture.catalogs) }) : 0,
    fixture.sellers.length ? prisma.sellerProfile.count({ where: ids(fixture.sellers) }) : 0,
    fixture.users.length ? prisma.user.count({ where: ids(fixture.users) }) : 0,
  ]);
  assert(counts.every((count) => count === 0), "EXACT_ID_CLEANUP_FAILED");
}

async function seller(label: string) {
  const key = randomUUID();
  const user = await prisma.user.create({ data: { name: "CRI", surname: label, email: `cri-${key}@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER", sellerProfile: { create: { storeName: `CRI-${key}`, storeSlug: `cri-${key}`, companyType: "QA", taxNumber: key, taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
  fixture.users.push(user.id); fixture.sellers.push(user.sellerProfile!.id); return user.sellerProfile!;
}

async function catalog(label: string) {
  const key = randomUUID();
  const row = await prisma.catalogProduct.create({ data: { slug: `cri-${key}`, identityKey: `cri-${key}`, name: `CRI ${label}`, brand: "QA", category: "QA", description: "QA", imageUrl: "/qa" } });
  fixture.catalogs.push(row.id); return row;
}

async function offer(sellerId: string, catalogProductId: string, label: string) {
  const row = await prisma.sellerOffer.create({ data: { sellerId, catalogProductId, sellerSku: `CRI-${label}-${randomUUID()}`, price: 100, stock: 3, active: true } });
  fixture.offers.push(row.id); return row;
}

async function main() {
  await cleanup();
  try {
    const identity = await prisma.$queryRaw<Array<{ database: string; role: string }>>`select current_database() as database, current_user as role`;
    assert(identity[0]?.database === "postgres" && identity[0]?.role === "postgres", "SERVER_IDENTITY_MISMATCH");
    const sellerA = await seller("A"), sellerB = await seller("B");
    const catalogA = await catalog("A"), catalogB = await catalog("B"), catalogC = await catalog("C");
    const offerA = await offer(sellerA.id, catalogA.id, "A"), offerA2 = await offer(sellerA.id, catalogB.id, "A2"), offerB = await offer(sellerB.id, catalogA.id, "B");
    const offerBefore = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offerA.id } });
    const base: CatalogReviewCreateInput = { sellerId: sellerA.id, sellerOfferId: offerA.id, sellerSku: offerA.sellerSku, proposedGtin: "4006381333931", candidateIds: [catalogA.id], matchStatus: "CONFLICT", reasonCode: "SKU_GTIN_CONFLICT", confidence: 1 };
    const create = (overrides: Partial<CatalogReviewCreateInput> = {}) => createOrGetOpenCatalogMatchReview(prisma, { ...base, ...overrides });

    const sequentialA = rememberReview(await create()), sequentialB = rememberReview(await create());
    assert(sequentialA.created && !sequentialB.created && sequentialA.review.id === sequentialB.review.id, "SEQUENTIAL_DEDUPE_FAILED");

    const concurrentPair = await Promise.all([create({ proposedGtin: "036000291452" }), create({ proposedGtin: "036000291452" })]);
    concurrentPair.forEach(rememberReview);
    assert(new Set(concurrentPair.map((result) => result.review.id)).size === 1 && concurrentPair.filter((result) => result.created).length === 1, "CONCURRENT_PAIR_DEDUPE_FAILED");

    const concurrentTen = await Promise.all(Array.from({ length: 10 }, () => create({ proposedGtin: "10012345678902" })));
    concurrentTen.forEach(rememberReview);
    assert(new Set(concurrentTen.map((result) => result.review.id)).size === 1 && concurrentTen.filter((result) => result.created).length === 1, "CONCURRENT_TEN_DEDUPE_FAILED");

    const differentGtin = rememberReview(await create({ proposedGtin: "96385074" }));
    const differentSeller = rememberReview(await create({ sellerId: sellerB.id, sellerOfferId: offerB.id, sellerSku: offerB.sellerSku }));
    const differentOffer = rememberReview(await create({ sellerOfferId: offerA2.id, sellerSku: offerA2.sellerSku }));
    const differentReason = rememberReview(await create({ reasonCode: "GTIN_BRAND_CONFLICT" }));
    assert(new Set([sequentialA.review.id, differentGtin.review.id, differentSeller.review.id, differentOffer.review.id, differentReason.review.id]).size === 5, "IDENTITY_DIMENSION_ISOLATION_FAILED");
    assert(differentSeller.review.sellerId === sellerB.id, "CROSS_SELLER_REVIEW_RETURNED");

    const textBase: Partial<CatalogReviewCreateInput> = { sellerOfferId: null, sellerSku: "CRI-TEXT", proposedGtin: null, candidateIds: [catalogB.id, catalogA.id], matchStatus: "REVIEW_REQUIRED", reasonCode: "MULTIPLE_TEXT_CANDIDATES", normalizedName: "Olta", normalizedBrand: "QA", normalizedModel: "X1", confidence: 0.4 };
    const candidateOrderA = rememberReview(await create(textBase));
    const candidateOrderB = rememberReview(await create({ ...textBase, candidateIds: [catalogA.id, catalogB.id, catalogA.id] }));
    const candidateSetChanged = rememberReview(await create({ ...textBase, candidateIds: [catalogA.id, catalogC.id] }));
    assert(candidateOrderA.review.id === candidateOrderB.review.id && candidateOrderA.review.id !== candidateSetChanged.review.id, "CANDIDATE_SET_IDENTITY_FAILED");

    const closed = await prisma.catalogMatchReview.update({ where: { id: sequentialA.review.id }, data: closeCatalogMatchReviewData(sequentialA.review, "RESOLVED"), select: { id: true, fingerprint: true, openFingerprint: true, status: true } });
    const reopened = rememberReview(await create());
    assert(closed.status === "RESOLVED" && closed.openFingerprint === null && closed.fingerprint === reopened.review.fingerprint && reopened.review.id !== closed.id && reopened.created, "REOPEN_AFTER_RESOLUTION_FAILED");

    const offerAfter = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offerA.id } });
    assert(JSON.stringify({ catalogProductId: offerBefore.catalogProductId, price: offerBefore.price.toString(), stock: offerBefore.stock, active: offerBefore.active, sellerSku: offerBefore.sellerSku, matchStatus: offerBefore.matchStatus, matchReason: offerBefore.matchReason, matchConfidence: offerBefore.matchConfidence?.toString() ?? null }) === JSON.stringify({ catalogProductId: offerAfter.catalogProductId, price: offerAfter.price.toString(), stock: offerAfter.stock, active: offerAfter.active, sellerSku: offerAfter.sellerSku, matchStatus: offerAfter.matchStatus, matchReason: offerAfter.matchReason, matchConfidence: offerAfter.matchConfidence?.toString() ?? null }), "REVIEW_FLOW_MUTATED_OFFER");
    assert(await prisma.catalogMatchReview.count({ where: { openFingerprint: concurrentTen[0].fingerprint, status: "PENDING" } }) === 1, "OPEN_FINGERPRINT_UNIQUENESS_FAILED");
    console.log("PASS: catalog review sequential/concurrent idempotency, lifecycle, isolation and offer immutability");
  } finally {
    await cleanup(); await verifyCleanup(); console.log("PASS: exact-ID catalog review fixtures removed"); await prisma.$disconnect();
  }
}

void main();
