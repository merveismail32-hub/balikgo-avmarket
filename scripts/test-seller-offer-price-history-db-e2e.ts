import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hash } from "bcryptjs";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { createSellerOfferWithPriceEvidence, SellerOfferPriceError, setSellerOfferPrice } from "../app/lib/seller-offer-price";
import { setSellerAbsoluteStock } from "../app/lib/stock-truth";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const prisma = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const token = crypto.randomUUID();
const prefix = `qa-price-${token}`;
const ids = { users: [] as string[], sellers: [] as string[], products: [] as string[], catalogs: [] as string[], offers: [] as string[], orders: [] as string[] };
const isCode = (code: string) => (error: unknown) => error instanceof SellerOfferPriceError && error.code === code;

async function cleanup() {
  if (ids.orders.length) await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  if (ids.offers.length) {
    const holds = await prisma.sellerOfferPriceAnomalyHold.findMany({ where: { sellerOfferId: { in: ids.offers } }, select: { id: true } });
    await prisma.sellerOfferPriceAnomalyRelease.deleteMany({ where: { holdId: { in: holds.map((hold) => hold.id) } } });
    await prisma.sellerOfferPriceAnomalyHold.deleteMany({ where: { id: { in: holds.map((hold) => hold.id) } } });
    await prisma.stockMovement.deleteMany({ where: { sellerOfferId: { in: ids.offers } } });
    await prisma.sellerOfferPriceObservation.deleteMany({ where: { sellerOfferId: { in: ids.offers } } });
    await prisma.sellerOffer.deleteMany({ where: { id: { in: ids.offers } } });
  }
  if (ids.products.length) await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  if (ids.catalogs.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: ids.catalogs } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}

async function main() {
  const identity = await prisma.$queryRaw<Array<{ database: string; role: string }>>`select current_database() database, current_user role`;
  assert.equal(identity[0]?.database, TEST_DB_IDENTITY.database); assert.equal(identity[0]?.role, "postgres");
  const passwordHash = await hash("qa-only", 4);
  for (const label of ["a", "b"]) {
    const user = await prisma.user.create({ data: { name: "QA", surname: label, email: `${prefix}-${label}@invalid.local`, phone: "0", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: `${prefix}-${label}`, companyType: "QA", taxNumber: crypto.randomUUID().replaceAll("-", "").slice(0, 10), taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
    ids.users.push(user.id); ids.sellers.push(user.sellerProfile!.id);
  }
  const catalog = await prisma.catalogProduct.create({ data: { slug: `${prefix}-catalog`, identityKey: prefix, name: "QA", category: "QA", brand: "QA", description: "QA", imageUrl: "/qa" } }); ids.catalogs.push(catalog.id);
  const product = await prisma.product.create({ data: { sellerId: ids.sellers[0], catalogProductId: catalog.id, name: "QA", slug: `${prefix}-product`, category: "QA", brand: "QA", price: "10000.00", stock: 5, description: "QA", imageUrl: "/qa" } }); ids.products.push(product.id);
  const offer = await prisma.$transaction((tx) => createSellerOfferWithPriceEvidence(tx, { data: { sellerId: ids.sellers[0], catalogProductId: catalog.id, legacyProductId: product.id, sellerSku: prefix, price: "10000.00", stock: 5 }, source: "SELLER_PRODUCT_CREATE", actorUserId: ids.users[0] })); ids.offers.push(offer.id);
  assert.equal(await prisma.sellerOfferPriceObservation.count({ where: { sellerOfferId: offer.id } }), 1);

  const first = await prisma.$transaction((tx) => setSellerOfferPrice(tx, { sellerOfferId: offer.id, sellerId: ids.sellers[0], productId: product.id, expectedPriceVersion: 1, price: "9800.00", source: "SELLER_PRODUCT_PATCH", actorUserId: ids.users[0] }));
  assert.equal(first.changed, true); assert.equal(first.priceVersion, 2);
  const noop = await prisma.$transaction((tx) => setSellerOfferPrice(tx, { sellerOfferId: offer.id, sellerId: ids.sellers[0], productId: product.id, expectedPriceVersion: 2, price: "9800.0", source: "SELLER_PRODUCT_PATCH", actorUserId: ids.users[0] }));
  assert.equal(noop.changed, false); assert.equal(await prisma.sellerOfferPriceObservation.count({ where: { sellerOfferId: offer.id } }), 2);
  await assert.rejects(() => prisma.$transaction((tx) => setSellerOfferPrice(tx, { sellerOfferId: offer.id, sellerId: ids.sellers[0], productId: product.id, expectedPriceVersion: 1, price: "9700", source: "SELLER_PRODUCT_PATCH", actorUserId: ids.users[0] })), isCode("STALE_PRICE_VERSION"));
  await assert.rejects(() => prisma.$transaction((tx) => setSellerOfferPrice(tx, { sellerOfferId: offer.id, sellerId: ids.sellers[1], productId: product.id, expectedPriceVersion: 2, price: "1", source: "SELLER_PRODUCT_PATCH", actorUserId: ids.users[1] })), isCode("OFFER_NOT_FOUND"));

  const race = await Promise.allSettled(["9500", "9400"].map((price) => prisma.$transaction((tx) => setSellerOfferPrice(tx, { sellerOfferId: offer.id, sellerId: ids.sellers[0], productId: product.id, expectedPriceVersion: 2, price, source: "SELLER_INVENTORY", actorUserId: ids.users[0] }))));
  assert.equal(race.filter((value) => value.status === "fulfilled").length, 1); assert.equal(race.filter((value) => value.status === "rejected").length, 1);
  const afterRace = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } });
  assert.equal(afterRace.priceVersion, 3); assert.equal(await prisma.sellerOfferPriceObservation.count({ where: { sellerOfferId: offer.id } }), 3);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).price.toString(), afterRace.price.toString());

  const beforeRollback = afterRace.price.toString();
  await assert.rejects(() => prisma.$transaction((tx) => setSellerOfferPrice(tx, { sellerOfferId: offer.id, sellerId: ids.sellers[0], productId: product.id, expectedPriceVersion: 3, price: "9300", source: "SELLER_PRODUCT_PATCH", actorUserId: "missing-actor" })));
  const rolledBack = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } }); assert.equal(rolledBack.price.toString(), beforeRollback); assert.equal(rolledBack.priceVersion, 3);

  const inventoryBefore = rolledBack.inventoryVersion;
  await prisma.$transaction((tx) => setSellerOfferPrice(tx, { sellerOfferId: offer.id, sellerId: ids.sellers[0], productId: product.id, expectedPriceVersion: 3, price: "9200", source: "SELLER_INVENTORY", actorUserId: ids.users[0] }));
  const priceChanged = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } }); assert.equal(priceChanged.inventoryVersion, inventoryBefore);
  await prisma.$transaction((tx) => setSellerAbsoluteStock(tx, { sellerOfferId: offer.id, productId: product.id, sellerId: ids.sellers[0], expectedVersion: inventoryBefore, quantity: 4, idempotencyKey: `${prefix}-stock`, source: "QA", actorSellerId: ids.sellers[0] }));
  assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).priceVersion, priceChanged.priceVersion);

  const customer = await prisma.user.create({ data: { name: "QA", surname: "Customer", email: `${prefix}-customer@invalid.local`, phone: "0", passwordHash } }); ids.users.push(customer.id);
  const order = await prisma.order.create({ data: { userId: customer.id, orderNumber: `QA-PRICE-${token}`, clientRequestId: crypto.randomUUID(), totalAmount: "9200", recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", items: { create: { productId: product.id, sellerId: ids.sellers[0], catalogProductId: catalog.id, sellerOfferId: offer.id, productName: "QA", productImageUrl: "/qa", unitPrice: "9200", quantity: 1 } }, payment: { create: { amount: "9200" } } } }); ids.orders.push(order.id);
  await prisma.$transaction((tx) => setSellerOfferPrice(tx, { sellerOfferId: offer.id, sellerId: ids.sellers[0], productId: product.id, expectedPriceVersion: 4, price: "9100", source: "SELLER_PRODUCT_PATCH", actorUserId: ids.users[0] }));
  const historical = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, payment: true } }); assert.equal(historical.items[0].unitPrice.toString(), "9200"); assert.equal(historical.payment!.amount.toString(), "9200");
  assert.equal(await prisma.sellerOfferPriceObservation.count({ where: { sellerOfferId: offer.id } }), 5);
  console.log("PASS: #25 Slice B guarded TEST DB initial/change evidence, no-op, stale/IDOR CAS, concurrent exactly-once, rollback, stock separation and historical economics");
}

cleanup()
  .then(main)
  .finally(async () => { await cleanup(); await prisma.$disconnect(); });
