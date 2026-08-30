import "server-only";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { guardedTestConnectionOptions, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { decrementForCheckout, restoreCancellation, setSellerAbsoluteStock, StockTruthError } from "../app/lib/stock-truth";

const prisma = new PrismaClient({ adapter: new PrismaPg(guardedTestConnectionOptions()), transactionOptions: { maxWait: 15_000, timeout: 30_000 } });
const ids = { users: [] as string[], sellers: [] as string[], catalogs: [] as string[], products: [] as string[], offers: [] as string[], movements: [] as string[] };
const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
const failed = (result: PromiseSettledResult<unknown>, code: string) => result.status === "rejected" && result.reason instanceof StockTruthError && result.reason.code === code;
async function actor(label: string, stock = 10) {
  const key = randomUUID();
  const user = await prisma.user.create({ data: { name: "ST", surname: label, email: `stock-${key}@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER", sellerProfile: { create: { storeName: `ST-${key}`, storeSlug: `st-${key}`, companyType: "QA", taxNumber: `st-${key}`, taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
  ids.users.push(user.id); ids.sellers.push(user.sellerProfile!.id);
  const catalog = await prisma.catalogProduct.create({ data: { slug: `st-c-${key}`, identityKey: `st:${key}`, name: "ST", category: "QA", brand: "QA", description: "QA", imageUrl: "/qa" } }); ids.catalogs.push(catalog.id);
  const product = await prisma.product.create({ data: { sellerId: user.sellerProfile!.id, catalogProductId: catalog.id, name: "ST", slug: `st-p-${key}`, category: "QA", brand: "QA", price: 10, stock, description: "QA", imageUrl: "/qa" } }); ids.products.push(product.id);
  const offer = await prisma.sellerOffer.create({ data: { sellerId: user.sellerProfile!.id, catalogProductId: catalog.id, legacyProductId: product.id, sellerSku: `ST-${key}`, price: 10, stock } }); ids.offers.push(offer.id);
  return { sellerId: user.sellerProfile!.id, productId: product.id, offerId: offer.id };
}
async function snapshot(x: { productId: string; offerId: string }) {
  const offer = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: x.offerId } });
  const product = await prisma.product.findUniqueOrThrow({ where: { id: x.productId } });
  const movements = await prisma.stockMovement.findMany({ where: { sellerOfferId: x.offerId }, orderBy: { createdAt: "asc" } });
  return [offer, product, movements] as const;
}
async function cleanup() {
  const movementRows = await prisma.stockMovement.findMany({ where: { sellerOfferId: { in: ids.offers } }, select: { id: true } }); ids.movements.push(...movementRows.map(x => x.id));
  if (ids.movements.length) await prisma.stockMovement.deleteMany({ where: { id: { in: [...new Set(ids.movements)] } } });
  if (ids.offers.length) await prisma.sellerOffer.deleteMany({ where: { id: { in: ids.offers } } });
  if (ids.products.length) await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  if (ids.catalogs.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: ids.catalogs } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  const counts = await Promise.all([prisma.stockMovement.count({ where: { id: { in: ids.movements } } }), prisma.sellerOffer.count({ where: { id: { in: ids.offers } } }), prisma.product.count({ where: { id: { in: ids.products } } }), prisma.user.count({ where: { id: { in: ids.users } } })]);
  assert(counts.every(x => x === 0), "EXACT_ID_CLEANUP_FAILED");
}
async function main() {
  const identity = await prisma.$queryRaw<Array<{ database: string; role: string }>>`select current_database() database,current_user role`;
  assert(identity[0]?.database === TEST_DB_IDENTITY.database && identity[0]?.role === "postgres", "TEST_IDENTITY_MISMATCH");
  const a = await actor("A", 3); const base = { sellerOfferId: a.offerId, productId: a.productId, sellerId: a.sellerId, actorSellerId: a.sellerId, source: "CHECKOUT" };
  const key = `stock:v1:checkout:${randomUUID()}:${a.offerId}`;
  const first = await prisma.$transaction(tx => decrementForCheckout(tx, { ...base, quantity: 1, idempotencyKey: key }));
  const replay = await prisma.$transaction(tx => decrementForCheckout(tx, { ...base, quantity: 1, idempotencyKey: key }));
  assert(!first.replay && replay.replay, "SEQUENTIAL_REPLAY_FAILED");
  let [offer, product, movements] = await snapshot(a); assert(offer.stock === 2 && product.stock === 2 && offer.inventoryVersion === 1 && movements.length === 1 && movements[0].stockBefore === 3 && movements[0].stockAfter === 2 && movements[0].quantityDelta === -1, "DECREMENT_AUDIT_FAILED");
  await prisma.$transaction(tx => decrementForCheckout(tx, { ...base, quantity: 2, idempotencyKey: key })).then(() => { throw new Error("PAYLOAD_CONFLICT_ACCEPTED"); }, e => assert(e instanceof StockTruthError && e.code === "IDEMPOTENCY_CONFLICT", "PAYLOAD_CONFLICT_WRONG"));
  const sameKey = `stock:v1:checkout:${randomUUID()}:${a.offerId}`; const ten = await Promise.allSettled(Array.from({ length: 10 }, () => prisma.$transaction(tx => decrementForCheckout(tx, { ...base, quantity: 1, idempotencyKey: sameKey })))); assert(ten.every(x => x.status === "fulfilled"), "CONCURRENT_REPLAY_FAILED");
  [offer, product, movements] = await snapshot(a); assert(offer.stock === 1 && product.stock === 1 && movements.length === 2, "CONCURRENT_REPLAY_MUTATED_MORE_THAN_ONCE");
  const race = await Promise.allSettled(["a", "b"].map(label => prisma.$transaction(tx => decrementForCheckout(tx, { ...base, quantity: 1, idempotencyKey: `stock:v1:checkout:${label}-${randomUUID()}:${a.offerId}` })))); assert(race.filter(x => x.status === "fulfilled").length === 1, "LAST_ITEM_RACE_FAILED");
  const b = await actor("B", 5); const beforeB = await snapshot(b);
  await prisma.$transaction(async tx => { await decrementForCheckout(tx, { ...base, quantity: 1, idempotencyKey: `stock:v1:checkout:${randomUUID()}:${a.offerId}` }); await decrementForCheckout(tx, { sellerOfferId: b.offerId, productId: b.productId, sellerId: b.sellerId, actorSellerId: b.sellerId, quantity: 99, idempotencyKey: `stock:v1:checkout:${randomUUID()}:${b.offerId}`, source: "CHECKOUT" }); }).then(() => { throw new Error("ROLLBACK_NOT_TRIGGERED"); }, () => undefined);
  const afterB = await snapshot(b); assert(beforeB[0].stock === afterB[0].stock && beforeB[2].length === afterB[2].length, "MULTILINE_ROLLBACK_FAILED");
  const manual = await prisma.$transaction(tx => setSellerAbsoluteStock(tx, { sellerOfferId: b.offerId, productId: b.productId, sellerId: b.sellerId, expectedVersion: 0, quantity: 7, idempotencyKey: `stock:v1:seller-set:${b.offerId}:0:7`, source: "SELLER", actorSellerId: b.sellerId })); assert(manual.stock === 7 && manual.inventoryVersion === 1, "MANUAL_SET_FAILED");
  const noop = await prisma.$transaction(tx => setSellerAbsoluteStock(tx, { sellerOfferId: b.offerId, productId: b.productId, sellerId: b.sellerId, expectedVersion: 1, quantity: 7, idempotencyKey: `stock:v1:seller-set:${b.offerId}:1:7`, source: "SELLER", actorSellerId: b.sellerId })); assert(noop.noChange && noop.inventoryVersion === 1, "NOOP_FAILED");
  await prisma.$transaction(tx => setSellerAbsoluteStock(tx, { sellerOfferId: b.offerId, productId: b.productId, sellerId: b.sellerId, expectedVersion: 0, quantity: 8, idempotencyKey: `stock:v1:seller-set:${b.offerId}:0:8`, source: "SELLER", actorSellerId: b.sellerId })).then(() => { throw new Error("STALE_ACCEPTED"); }, e => assert(e instanceof StockTruthError && e.code === "STALE_INVENTORY_VERSION", "STALE_WRONG"));
  const manualRace = await Promise.allSettled([8, 9].map(quantity => prisma.$transaction(tx => setSellerAbsoluteStock(tx, { sellerOfferId: b.offerId, productId: b.productId, sellerId: b.sellerId, expectedVersion: 1, quantity, idempotencyKey: `stock:v1:seller-set:${b.offerId}:1:${quantity}`, source: "SELLER", actorSellerId: b.sellerId })))); assert(manualRace.filter(x => x.status === "fulfilled").length === 1, "MANUAL_CAS_RACE_FAILED");
  await prisma.$transaction(tx => setSellerAbsoluteStock(tx, { sellerOfferId: b.offerId, productId: b.productId, sellerId: a.sellerId, expectedVersion: 2, quantity: 1, idempotencyKey: `stock:v1:seller-set:${b.offerId}:2:1`, source: "SELLER", actorSellerId: a.sellerId })).then(() => { throw new Error("ISOLATION_FAILED"); }, e => assert(e instanceof StockTruthError && e.code === "OFFER_NOT_FOUND", "ISOLATION_WRONG"));
  await prisma.$transaction(tx => restoreCancellation(tx, { sellerOfferId: b.offerId, productId: b.productId, quantity: 1, orderItemId: "synthetic-item", idempotencyKey: "stock:v1:cancellation:synthetic-item", source: "CUSTOMER" })); await prisma.$transaction(tx => restoreCancellation(tx, { sellerOfferId: b.offerId, productId: b.productId, quantity: 1, orderItemId: "synthetic-item", idempotencyKey: "stock:v1:cancellation:synthetic-item", source: "CUSTOMER" }));
  for (const [label, run] of [["OFFER_CHECK", () => prisma.sellerOffer.update({ where: { id: b.offerId }, data: { stock: -1 } })], ["PRODUCT_CHECK", () => prisma.product.update({ where: { id: b.productId }, data: { stock: -1 } })]] as const) await run().then(() => { throw new Error(`${label}_FAILED`); }, () => undefined);
  const rollbackBefore = await snapshot(b); await prisma.$transaction(tx => decrementForCheckout(tx, { sellerOfferId: b.offerId, productId: b.productId, sellerId: b.sellerId, actorSellerId: b.sellerId, quantity: 1, idempotencyKey: "x".repeat(192), source: "CHECKOUT" })).then(() => { throw new Error("MOVEMENT_FAILURE_ACCEPTED"); }, () => undefined); const rollbackAfter = await snapshot(b); assert(rollbackBefore[0].stock === rollbackAfter[0].stock && rollbackBefore[2].length === rollbackAfter[2].length, "MOVEMENT_FAILURE_ROLLBACK_FAILED");

  for (const [label, initial, target] of [["LOW", 4, 8], ["HIGH", 20, 3]] as const) {
    const x = await actor(`RACE-${label}`, initial);
    const manualKey = `stock:v1:seller-set:${x.offerId}:0:${target}`;
    const checkoutKey = `stock:v1:checkout:${randomUUID()}:${x.offerId}`;
    const raced = await Promise.allSettled([
      prisma.$transaction(tx => setSellerAbsoluteStock(tx, { sellerOfferId: x.offerId, productId: x.productId, sellerId: x.sellerId, expectedVersion: 0, quantity: target, idempotencyKey: manualKey, source: "SELLER", actorSellerId: x.sellerId })),
      prisma.$transaction(tx => decrementForCheckout(tx, { sellerOfferId: x.offerId, productId: x.productId, sellerId: x.sellerId, actorSellerId: x.sellerId, quantity: 1, idempotencyKey: checkoutKey, source: "CHECKOUT" })),
    ]);
    const manualWon = raced[0].status === "fulfilled";
    assert(raced[1].status === "fulfilled", `MANUAL_CHECKOUT_${label}_SALE_LOST`);
    if (!manualWon) assert(failed(raced[0], "STALE_INVENTORY_VERSION"), `MANUAL_CHECKOUT_${label}_UNCONTROLLED_FAILURE`);
    const [finalOffer, finalProduct, finalMovements] = await snapshot(x);
    const expectedStock = manualWon ? target - 1 : initial - 1;
    const expectedMutations = manualWon ? 2 : 1;
    assert(finalOffer.stock === expectedStock && finalProduct.stock === expectedStock, `MANUAL_CHECKOUT_${label}_MATH_OR_PROJECTION_FAILED`);
    assert(finalOffer.inventoryVersion === expectedMutations && finalMovements.length === expectedMutations, `MANUAL_CHECKOUT_${label}_VERSION_OR_AUDIT_FAILED`);
  }

  const constraints = await actor("CONSTRAINTS", 5);
  const validMovement = { sellerOfferId: constraints.offerId, productId: constraints.productId, type: "SELLER_ABSOLUTE_SET" as const, stockBefore: 5, stockAfter: 6, quantityDelta: 1, inventoryVersionBefore: 0, inventoryVersionAfter: 1, source: "DB_CONSTRAINT_TEST" };
  for (const [label, data] of [
    ["DELTA_CHECK", { ...validMovement, id: randomUUID(), idempotencyKey: `stock:test:${randomUUID()}`, stockAfter: 7 }],
    ["VERSION_CHECK", { ...validMovement, id: randomUUID(), idempotencyKey: `stock:test:${randomUUID()}`, inventoryVersionAfter: 2 }],
  ] as const) {
    ids.movements.push(data.id);
    await prisma.stockMovement.create({ data }).then(() => { throw new Error(`${label}_ACCEPTED`); }, () => undefined);
    assert(await prisma.stockMovement.count({ where: { id: data.id } }) === 0, `${label}_PERSISTED`);
  }
  const uniqueKey = `stock:test:${randomUUID()}`;
  const uniqueA = randomUUID(), uniqueB = randomUUID(); ids.movements.push(uniqueA, uniqueB);
  await prisma.stockMovement.create({ data: { ...validMovement, id: uniqueA, idempotencyKey: uniqueKey } });
  await prisma.stockMovement.create({ data: { ...validMovement, id: uniqueB, idempotencyKey: uniqueKey } }).then(() => { throw new Error("IDEMPOTENCY_UNIQUE_ACCEPTED"); }, () => undefined);
  assert(await prisma.stockMovement.count({ where: { idempotencyKey: uniqueKey } }) === 1, "IDEMPOTENCY_UNIQUE_COUNT_FAILED");

  const projection = await actor("PROJECTION", 3); const projectionBefore = await snapshot(projection);
  await prisma.$transaction(tx => decrementForCheckout(tx, { sellerOfferId: projection.offerId, productId: randomUUID(), sellerId: projection.sellerId, actorSellerId: projection.sellerId, quantity: 1, idempotencyKey: `stock:v1:checkout:${randomUUID()}:${projection.offerId}`, source: "CHECKOUT" })).then(() => { throw new Error("PROJECTION_FAILURE_ACCEPTED"); }, () => undefined);
  const projectionAfter = await snapshot(projection);
  assert(projectionAfter[0].stock === projectionBefore[0].stock && projectionAfter[0].inventoryVersion === projectionBefore[0].inventoryVersion && projectionAfter[2].length === 0, "PROJECTION_FAILURE_ROLLBACK_FAILED");
  console.log("PASS: Stock Truth guarded DB E2E decrement, replay, concurrency, rollback, CAS, isolation, restore and DB constraints verified.");
}
main().finally(async () => { await cleanup(); await prisma.$disconnect(); });
