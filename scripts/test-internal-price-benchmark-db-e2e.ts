import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hash } from "bcryptjs";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { createSellerOfferWithPriceEvidence, setSellerOfferPrice } from "../app/lib/seller-offer-price";
import { getSellerInternalPriceBenchmark } from "../app/lib/internal-price-benchmark";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const prisma = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const token = crypto.randomUUID(); const prefix = `qa-benchmark-${token}`;
const ids = { users: [] as string[], sellers: [] as string[], catalogs: [] as string[], products: [] as string[], offers: [] as string[], orders: [] as string[] };

async function cleanup() {
  if (ids.orders.length) await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  if (ids.offers.length) { await prisma.sellerOfferPriceObservation.deleteMany({ where: { sellerOfferId: { in: ids.offers } } }); await prisma.sellerOffer.deleteMany({ where: { id: { in: ids.offers } } }); }
  if (ids.products.length) await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  if (ids.catalogs.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: ids.catalogs } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}

async function main() {
  const identity = await prisma.$queryRaw<Array<{ database: string; role: string }>>`select current_database() database, current_user role`;
  assert.equal(identity[0]?.database, TEST_DB_IDENTITY.database); assert.equal(identity[0]?.role, "postgres");
  const passwordHash = await hash("qa-only", 4);
  for (let index = 0; index < 7; index += 1) {
    const user = await prisma.user.create({ data: { name: "QA", surname: String(index), email: `${prefix}-${index}@invalid.local`, phone: "0", passwordHash, role: "SELLER", sellerProfile: { create: { storeName: `${prefix}-${index}`, companyType: "QA", taxNumber: crypto.randomUUID().replaceAll("-", "").slice(0, 10), taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
    ids.users.push(user.id); ids.sellers.push(user.sellerProfile!.id);
  }
  const catalog = await prisma.catalogProduct.create({ data: { slug: `${prefix}-catalog`, identityKey: `${prefix}-catalog`, name: "QA", category: "QA", brand: "QA", description: "QA", imageUrl: "/qa", active: true, moderationStatus: "APPROVED" } });
  const unrelated = await prisma.catalogProduct.create({ data: { slug: `${prefix}-unrelated`, identityKey: `${prefix}-unrelated`, name: "Other", category: "QA", brand: "QA", description: "QA", imageUrl: "/qa", active: true, moderationStatus: "APPROVED" } });
  ids.catalogs.push(catalog.id, unrelated.id);
  const specs = [
    { price: "120", active: true, stock: 5, catalogId: catalog.id },
    { price: "100", active: true, stock: 5, catalogId: catalog.id },
    { price: "110", active: true, stock: 5, catalogId: catalog.id },
    { price: "130", active: true, stock: 5, catalogId: catalog.id },
    { price: "1", active: false, stock: 5, catalogId: catalog.id },
    { price: "2", active: true, stock: 0, catalogId: catalog.id },
    { price: "3", active: true, stock: 5, catalogId: unrelated.id },
  ];
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const product = await prisma.product.create({ data: { sellerId: ids.sellers[index], catalogProductId: spec.catalogId, name: "QA", slug: `${prefix}-product-${index}`, category: "QA", brand: "QA", price: spec.price, stock: spec.stock, description: "QA", imageUrl: "/qa", active: spec.active } }); ids.products.push(product.id);
    const offer = await prisma.$transaction((tx) => createSellerOfferWithPriceEvidence(tx, { data: { sellerId: ids.sellers[index], catalogProductId: spec.catalogId, legacyProductId: product.id, sellerSku: `${prefix}-${index}`, price: spec.price, stock: spec.stock, active: spec.active }, source: "SELLER_PRODUCT_CREATE", actorUserId: ids.users[index] })); ids.offers.push(offer.id);
  }
  const benchmark = await getSellerInternalPriceBenchmark({ sellerId: ids.sellers[0], sellerOfferId: ids.offers[0] }, prisma);
  assert.deepEqual(benchmark, { catalogProductId: catalog.id, comparableCount: 3, evidenceState: "BENCHMARK_AVAILABLE", currency: "TRY", targetPrice: "120.00", minimumPrice: "100.00", maximumPrice: "130.00", medianPrice: "110.00", absoluteDifference: "10.00", percentageDifference: "9.0909", relativePosition: "ABOVE_MEDIAN" });
  assert.equal(await getSellerInternalPriceBenchmark({ sellerId: ids.sellers[1], sellerOfferId: ids.offers[0] }, prisma), null, "foreign seller read must fail closed");

  const customer = await prisma.user.create({ data: { name: "QA", surname: "Customer", email: `${prefix}-customer@invalid.local`, phone: "0", passwordHash } }); ids.users.push(customer.id);
  const order = await prisma.order.create({ data: { userId: customer.id, orderNumber: `QA-BENCHMARK-${token}`, clientRequestId: crypto.randomUUID(), totalAmount: "120", recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", items: { create: { productId: ids.products[0], catalogProductId: catalog.id, sellerOfferId: ids.offers[0], sellerId: ids.sellers[0], productName: "QA", productImageUrl: "/qa", unitPrice: "120", quantity: 1 } }, payment: { create: { amount: "120" } } } }); ids.orders.push(order.id);
  await prisma.$transaction((tx) => setSellerOfferPrice(tx, { sellerOfferId: ids.offers[1], sellerId: ids.sellers[1], productId: ids.products[1], expectedPriceVersion: 1, price: "140", source: "SELLER_PRODUCT_PATCH", actorUserId: ids.users[1] }));
  const changed = await getSellerInternalPriceBenchmark({ sellerId: ids.sellers[0], sellerOfferId: ids.offers[0] }, prisma);
  assert.equal(changed?.medianPrice, "130.00"); assert.equal(changed?.absoluteDifference, "-10.00"); assert.equal(changed?.relativePosition, "BELOW_MEDIAN");
  const historical = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, payment: true } }); assert.equal(historical.items[0].unitPrice.toString(), "120"); assert.equal(historical.payment!.amount.toString(), "120");
  assert.equal(await prisma.sellerOfferPriceObservation.count({ where: { sellerOfferId: ids.offers[1] } }), 2);
  console.log("PASS: #25 Slice C guarded TEST DB exact-product benchmark, eligibility/self/unrelated exclusion, seller IDOR, current-price refresh and historical economics");
}

cleanup().then(main).finally(async () => { await cleanup(); await prisma.$disconnect(); });
