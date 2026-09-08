import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hash } from "bcryptjs";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { createSellerOfferWithPriceEvidence, setSellerOfferPrice } from "../app/lib/seller-offer-price";
import { getSellerPricingAnomalyEvaluation } from "../app/lib/seller-pricing-anomaly";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const prisma = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const token = crypto.randomUUID(); const prefix = `qa-anomaly-${token}`;
const ids = { users: [] as string[], sellers: [] as string[], catalogs: [] as string[], products: [] as string[], offers: [] as string[], orders: [] as string[] };

async function cleanup() {
  if (ids.orders.length) await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  if (ids.offers.length) { const holds = await prisma.sellerOfferPriceAnomalyHold.findMany({ where: { sellerOfferId: { in: ids.offers } }, select: { id: true } }); await prisma.sellerOfferPriceAnomalyRelease.deleteMany({ where: { holdId: { in: holds.map((hold) => hold.id) } } }); await prisma.sellerOfferPriceAnomalyHold.deleteMany({ where: { id: { in: holds.map((hold) => hold.id) } } }); await prisma.sellerOfferPriceObservation.deleteMany({ where: { sellerOfferId: { in: ids.offers } } }); await prisma.sellerOffer.deleteMany({ where: { id: { in: ids.offers } } }); }
  if (ids.products.length) await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  if (ids.catalogs.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: ids.catalogs } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}

async function createOffer(index: number, catalogProductId: string, price: string) {
  const product = await prisma.product.create({ data: { sellerId: ids.sellers[index], catalogProductId, name: "QA", slug: `${prefix}-product-${index}`, category: "QA", brand: "QA", price, stock: 5, description: "QA", imageUrl: "/qa", active: true, moderationStatus: "APPROVED" } }); ids.products.push(product.id);
  const offer = await prisma.$transaction((tx) => createSellerOfferWithPriceEvidence(tx, { data: { sellerId: ids.sellers[index], catalogProductId, legacyProductId: product.id, sellerSku: `${prefix}-${index}`, price, stock: 5, active: true }, source: "SELLER_PRODUCT_CREATE", actorUserId: ids.users[index] })); ids.offers.push(offer.id);
  return { product, offer };
}

async function main() {
  const identity = await prisma.$queryRaw<Array<{ database: string; role: string }>>`select current_database() database, current_user role`;
  assert.equal(identity[0]?.database, TEST_DB_IDENTITY.database); assert.equal(identity[0]?.role, "postgres");
  const passwordHash = await hash("qa-only", 4);
  for (let index = 0; index < 6; index += 1) {
    const user = await prisma.user.create({ data: { name: "QA", surname: String(index), email: `${prefix}-${index}@invalid.local`, phone: "0", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: `${prefix}-${index}`, companyType: "QA", taxNumber: crypto.randomUUID().replaceAll("-", "").slice(0, 10), taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } }); ids.users.push(user.id); ids.sellers.push(user.sellerProfile!.id);
  }
  const catalog = await prisma.catalogProduct.create({ data: { slug: `${prefix}-catalog`, identityKey: `${prefix}-catalog`, name: "QA", category: "QA", brand: "QA", description: "QA", imageUrl: "/qa", active: true, moderationStatus: "APPROVED" } });
  const weakCatalog = await prisma.catalogProduct.create({ data: { slug: `${prefix}-weak`, identityKey: `${prefix}-weak`, name: "QA Weak", category: "QA", brand: "QA", description: "QA", imageUrl: "/qa", active: true, moderationStatus: "APPROVED" } }); ids.catalogs.push(catalog.id, weakCatalog.id);
  const target = await createOffer(0, catalog.id, "100"); await createOffer(1, catalog.id, "90"); await createOffer(2, catalog.id, "100"); await createOffer(3, catalog.id, "110");
  const weakTarget = await createOffer(4, weakCatalog.id, "10"); await createOffer(5, weakCatalog.id, "100");
  const evaluatedAt = new Date("2026-09-07T12:00:00.000Z");
  const normal = await getSellerPricingAnomalyEvaluation({ sellerId: ids.sellers[0], sellerOfferId: target.offer.id, evaluatedAt }, prisma);
  assert.equal(normal?.status, "NORMAL"); assert.equal(normal?.confidence, "MEDIUM"); assert.equal(normal?.benchmark.medianPrice, "100.00"); assert.deepEqual(normal?.reasons, []);
  assert.equal(await getSellerPricingAnomalyEvaluation({ sellerId: ids.sellers[1], sellerOfferId: target.offer.id, evaluatedAt }, prisma), null, "foreign seller evaluation must fail closed");
  const weak = await getSellerPricingAnomalyEvaluation({ sellerId: ids.sellers[4], sellerOfferId: weakTarget.offer.id, evaluatedAt }, prisma); assert.equal(weak?.status, "INSUFFICIENT_EVIDENCE"); assert.equal(weak?.confidence, "LOW");

  const customer = await prisma.user.create({ data: { name: "QA", surname: "Customer", email: `${prefix}-customer@invalid.local`, phone: "0", passwordHash } }); ids.users.push(customer.id);
  const order = await prisma.order.create({ data: { userId: customer.id, orderNumber: `QA-ANOMALY-${token}`, clientRequestId: crypto.randomUUID(), totalAmount: "100", recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", items: { create: { productId: target.product.id, catalogProductId: catalog.id, sellerOfferId: target.offer.id, sellerId: ids.sellers[0], productName: "QA", productImageUrl: "/qa", unitPrice: "100", quantity: 1 } }, payment: { create: { amount: "100" } } } }); ids.orders.push(order.id);
  await prisma.$transaction((tx) => setSellerOfferPrice(tx, { sellerOfferId: target.offer.id, sellerId: ids.sellers[0], productId: target.product.id, expectedPriceVersion: 1, price: "20", source: "SELLER_PRODUCT_PATCH", actorUserId: ids.users[0] }));
  const lowBefore = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: target.offer.id } });
  const low = await getSellerPricingAnomalyEvaluation({ sellerId: ids.sellers[0], sellerOfferId: target.offer.id, evaluatedAt }, prisma);
  assert.equal(low?.status, "CRITICAL"); assert.equal(low?.confidence, "HIGH"); assert.deepEqual(low?.reasons, ["PEER_PRICE_EXTREME_LOW", "SUDDEN_PRICE_DROP"]); assert.equal(low?.history.previousPrice, "100.00");
  const lowAfter = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: target.offer.id } }); assert.deepEqual({ price: lowAfter.price.toString(), priceVersion: lowAfter.priceVersion, active: lowAfter.active }, { price: lowBefore.price.toString(), priceVersion: lowBefore.priceVersion, active: lowBefore.active });
  await prisma.$transaction((tx) => setSellerOfferPrice(tx, { sellerOfferId: target.offer.id, sellerId: ids.sellers[0], productId: target.product.id, expectedPriceVersion: 2, price: "200", source: "SELLER_PRODUCT_PATCH", actorUserId: ids.users[0] }));
  const high = await getSellerPricingAnomalyEvaluation({ sellerId: ids.sellers[0], sellerOfferId: target.offer.id, evaluatedAt }, prisma); assert.equal(high?.status, "CRITICAL"); assert.equal(high?.confidence, "HIGH"); assert.deepEqual(high?.reasons, ["PEER_PRICE_EXTREME_HIGH", "SUDDEN_PRICE_INCREASE"]);
  const historical = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, payment: true } }); assert.equal(historical.items[0].unitPrice.toString(), "100"); assert.equal(historical.payment!.amount.toString(), "100");
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: target.product.id } })).active, true); assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: target.offer.id } })).active, true);
  console.log("PASS: #25 Slice D guarded TEST DB normal/low/high anomaly, history support, weak cohort, IDOR, read-only authority and historical economics");
}

cleanup().then(main).finally(async () => { await cleanup(); await prisma.$disconnect(); });
