import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { creditWallet, reserveWalletForCheckout } from "../app/lib/stored-value";
import { StoredValueDomainError } from "../app/lib/stored-value-domain";
import { finalizeInternalWalletPayment } from "../app/lib/wallet-tender-lifecycle";
import { processPaymentCallback } from "../app/lib/payment-orchestrator";

async function main() {
const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const db = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const tag = randomUUID(), now = new Date();
const userIds: string[] = [], orderIds: string[] = [], paymentIds: string[] = [];
try {
const user = await db.user.create({ data: { name: "QA", surname: "Tender", email: `${tag}@invalid.local`, phone: "0", passwordHash: "test-only" } });
userIds.push(user.id);
const order = await db.order.create({ data: { userId: user.id, orderNumber: `TENDER-${tag}`, clientRequestId: tag, totalAmount: "100.00", recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA" } });
const payment = await db.payment.create({ data: { orderId: order.id, amount: "100.00", currency: "TRY", provider: "QA", status: "PENDING", idempotencyKey: `payment:${tag}` } });
orderIds.push(order.id); paymentIds.push(payment.id);
await db.$transaction(tx => creditWallet(tx, { userId: user.id, amount: "60.00", currency: "TRY", fundingSource: "MANUAL_ADJUSTMENT", sourceType: "QA", sourceReference: tag, idempotencyKey: `credit:${tag}`, reason: "QA", effectiveAt: now }));
const first = await db.$transaction(tx => reserveWalletForCheckout(tx, { userId: user.id, orderId: order.id, paymentId: payment.id, payable: "100.00", currency: "TRY", idempotencyKey: `reserve:${tag}`, effectiveAt: now }));
assert.equal(first.walletTender.toFixed(2), "60.00"); assert.equal(first.externalTender.toFixed(2), "40.00");
const replay = await db.$transaction(tx => reserveWalletForCheckout(tx, { userId: user.id, orderId: order.id, paymentId: payment.id, payable: "100.00", currency: "TRY", idempotencyKey: `reserve:${tag}`, effectiveAt: now }));
assert.equal(replay.replay, true);
await assert.rejects(db.$transaction(tx => reserveWalletForCheckout(tx, { userId: user.id, orderId: order.id, paymentId: payment.id, payable: "99.00", currency: "TRY", idempotencyKey: `reserve:${tag}`, effectiveAt: now })), (e: unknown) => e instanceof StoredValueDomainError && e.code === "STORED_VALUE_IDEMPOTENCY_CONFLICT");
const reservation = await db.walletTransaction.findFirstOrThrow({ where: { paymentId: payment.id, type: "DEBIT_RESERVED" } });
const walletAccount = await db.walletAccount.findUniqueOrThrow({ where: { userId_currency: { userId: user.id, currency: "TRY" } } });
const allocation = await db.walletTenderAllocation.create({ data: { orderId: order.id, paymentId: payment.id, currency: "TRY", totalCustomerPayable: "100.00", walletTenderAmount: "60.00", externalTenderAmount: "40.00", walletAccountId: walletAccount.id, walletReservationId: reservation.id, allocationVersion: "WALLET_TENDER_V1", idempotencyKey: `allocation:${tag}`, semanticHash: "a".repeat(64), effectiveAt: now } });
assert.equal(allocation.walletTenderAmount.add(allocation.externalTenderAmount).toFixed(2), allocation.totalCustomerPayable.toFixed(2));
await db.payment.update({ where: { id: payment.id }, data: { amount: first.externalTender } });
assert.equal((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).amount.toFixed(2), "40.00");
await processPaymentCallback(db, { provider: "QA", event: { eventId: `wallet-success:${tag}`, paymentId: payment.id, eventType: "PAYMENT_PAID", amount: "40.00", currency: "TRY", providerPaymentId: `provider:${tag}` } });
assert.equal((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, "PAID");
assert.equal((await db.walletTenderAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).lifecycleStatus, "CAPTURED");
assert.equal(await db.walletTransaction.count({ where: { paymentId: payment.id, type: "DEBIT_CAPTURED" } }), 1);
const fullOrder = await db.order.create({ data: { userId: user.id, orderNumber: `FULL-${tag}`, clientRequestId: randomUUID(), totalAmount: "50.00", recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", walletUse: true } });
orderIds.push(fullOrder.id);
const fullPayment = await db.payment.create({ data: { orderId: fullOrder.id, amount: "50.00", currency: "TRY", provider: "QA", status: "PENDING", idempotencyKey: `full-payment:${tag}` } });
paymentIds.push(fullPayment.id);
await db.$transaction(tx => creditWallet(tx, { userId: user.id, amount: "50.00", currency: "TRY", fundingSource: "MANUAL_ADJUSTMENT", sourceType: "QA", sourceReference: `full:${tag}`, idempotencyKey: `full-credit:${tag}`, reason: "QA", effectiveAt: now }));
const full = await db.$transaction(tx => reserveWalletForCheckout(tx, { userId: user.id, orderId: fullOrder.id, paymentId: fullPayment.id, payable: "50.00", currency: "TRY", idempotencyKey: `full-reserve:${tag}`, effectiveAt: now }));
assert.equal(full.walletTender.toFixed(2), "50.00"); assert.equal(full.externalTender.toFixed(2), "0.00");
await db.payment.update({ where: { id: fullPayment.id }, data: { amount: "0.00" } });
await db.walletTenderAllocation.create({ data: { orderId: fullOrder.id, paymentId: fullPayment.id, currency: "TRY", totalCustomerPayable: "50.00", walletTenderAmount: "50.00", externalTenderAmount: "0.00", walletAccountId: walletAccount.id, walletReservationId: full.transaction!.id, allocationVersion: "WALLET_TENDER_V1", idempotencyKey: `full-allocation:${tag}`, semanticHash: "c".repeat(64), effectiveAt: now } });
const persistedFull = await db.payment.findUniqueOrThrow({ where: { id: fullPayment.id } }); assert.equal(persistedFull.status, "PENDING");
await finalizeInternalWalletPayment(db, { paymentId: fullPayment.id, userId: user.id, idempotencyKey: `wallet-internal-capture:${tag}`, effectiveAt: now });
assert.equal((await db.payment.findUniqueOrThrow({ where: { id: fullPayment.id } })).status, "PAID");
const beforeRollback = await db.walletAccount.findUniqueOrThrow({ where: { userId_currency: { userId: user.id, currency: "TRY" } } });
await assert.rejects(db.$transaction(async tx => { const rollbackOrder = await tx.order.create({ data: { userId: user.id, orderNumber: `ROLLBACK-${tag}`, clientRequestId: randomUUID(), totalAmount: "10.00", recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", walletUse: true } }); const rollbackPayment = await tx.payment.create({ data: { orderId: rollbackOrder.id, amount: "10.00", currency: "TRY", provider: "QA", status: "PENDING", idempotencyKey: `rollback-payment:${tag}` } }); await reserveWalletForCheckout(tx, { userId: user.id, orderId: rollbackOrder.id, paymentId: rollbackPayment.id, payable: "10.00", currency: "TRY", idempotencyKey: `rollback-reserve:${tag}`, effectiveAt: now }); throw new Error("QA_ROLLBACK"); }));
const afterRollback = await db.walletAccount.findUniqueOrThrow({ where: { userId_currency: { userId: user.id, currency: "TRY" } } }); assert(afterRollback.version >= beforeRollback.version);
// Concurrent no-overspend: two distinct reservations share one locked account.
const raceUser = await db.user.create({ data: { name: "QA", surname: "Race", email: `${tag}-race@invalid.local`, phone: "0", passwordHash: "test-only" } });
userIds.push(raceUser.id);
await db.$transaction(tx => creditWallet(tx, { userId: raceUser.id, amount: "100.00", currency: "TRY", fundingSource: "MANUAL_ADJUSTMENT", sourceType: "QA", sourceReference: `race:${tag}`, idempotencyKey: `race-initial-credit:${tag}`, reason: "QA", effectiveAt: now }));
const raceOrders = await Promise.all([1, 2].map(i => db.order.create({ data: { userId: raceUser.id, orderNumber: `RACE-${tag}-${i}`, clientRequestId: randomUUID(), totalAmount: "80.00", recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", walletUse: true } })));
orderIds.push(...raceOrders.map(orderRow => orderRow.id));
const racePayments = await Promise.all(raceOrders.map((o, i) => db.payment.create({ data: { orderId: o.id, amount: "80.00", currency: "TRY", provider: "QA", status: "PENDING", idempotencyKey: `race-payment:${tag}:${i}` } })));
paymentIds.push(...racePayments.map(paymentRow => paymentRow.id));
await Promise.all(racePayments.map((p, i) => db.$transaction(tx => reserveWalletForCheckout(tx, { userId: raceUser.id, orderId: raceOrders[i].id, paymentId: p.id, payable: "80.00", currency: "TRY", idempotencyKey: `race-reserve:${tag}:${i}`, effectiveAt: now }))));
const raceAccount = await db.walletAccount.findUniqueOrThrow({ where: { userId_currency: { userId: raceUser.id, currency: "TRY" } } }); assert(raceAccount.reservedBalance.lte(100)); assert(raceAccount.availableBalance.gte(0));
// A real reservation/credit race on the same account: both transactions start together.
const creditRaceUser = await db.user.create({ data: { name: "QA", surname: "CreditRace", email: `${tag}-credit-race@invalid.local`, phone: "0", passwordHash: "test-only" } }); userIds.push(creditRaceUser.id);
await db.$transaction(tx => creditWallet(tx, { userId: creditRaceUser.id, amount: "100.00", currency: "TRY", fundingSource: "MANUAL_ADJUSTMENT", sourceType: "QA", sourceReference: `credit-race-initial:${tag}`, idempotencyKey: `credit-race-initial:${tag}`, reason: "QA", effectiveAt: now }));
const creditRaceAccount = await db.walletAccount.findUniqueOrThrow({ where: { userId_currency: { userId: creditRaceUser.id, currency: "TRY" } } });
const raceBefore = await db.walletAccount.findUniqueOrThrow({ where: { id: creditRaceAccount.id } });
const raceOrder = await db.order.create({ data: { userId: creditRaceUser.id, orderNumber: `RACE-CREDIT-${tag}`, clientRequestId: randomUUID(), totalAmount: "60.00", recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", walletUse: true } });
const racePayment = await db.payment.create({ data: { orderId: raceOrder.id, amount: "60.00", currency: "TRY", provider: "QA", status: "PENDING", idempotencyKey: `race-credit-payment:${tag}` } });
orderIds.push(raceOrder.id); paymentIds.push(racePayment.id);
await Promise.all([
  db.$transaction(tx => reserveWalletForCheckout(tx, { userId: creditRaceUser.id, orderId: raceOrder.id, paymentId: racePayment.id, payable: "60.00", currency: "TRY", idempotencyKey: `race-credit-reserve:${tag}`, effectiveAt: now })),
  db.$transaction(tx => creditWallet(tx, { userId: creditRaceUser.id, amount: "40.00", currency: "TRY", fundingSource: "MANUAL_ADJUSTMENT", sourceType: "QA", sourceReference: `race-credit:${tag}`, idempotencyKey: `race-credit:${tag}`, reason: "QA", effectiveAt: now })),
]);
const raceAfter = await db.walletAccount.findUniqueOrThrow({ where: { id: creditRaceAccount.id } });
assert.equal(raceAfter.availableBalance.toFixed(2), raceBefore.availableBalance.minus(60).add(40).toFixed(2));
assert.equal(raceAfter.reservedBalance.toFixed(2), raceBefore.reservedBalance.add(60).toFixed(2));
assert.equal(raceAfter.version, raceBefore.version + 2);
const raceLedger = await db.walletTransaction.findMany({ where: { walletAccountId: creditRaceAccount.id }, orderBy: { createdAt: "asc" } });
assert.equal(raceLedger.length, 3);
assert.equal(raceLedger.at(-1)?.availableBalanceAfter.toFixed(2), raceAfter.availableBalance.toFixed(2));
assert(raceAfter.availableBalance.gte(0) && raceAfter.reservedBalance.gte(0));
// Cross-user ownership boundary: B's payment/order cannot be reserved by A.
const userB = await db.user.create({ data: { name: "QA", surname: "Other", email: `${tag}-b@invalid.local`, phone: "0", passwordHash: "test-only" } }); userIds.push(userB.id);
const orderB = await db.order.create({ data: { userId: userB.id, orderNumber: `ISOLATION-${tag}`, clientRequestId: randomUUID(), totalAmount: "10.00", recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA" } }); orderIds.push(orderB.id);
const paymentB = await db.payment.create({ data: { orderId: orderB.id, amount: "10.00", currency: "TRY", provider: "QA", status: "PENDING", idempotencyKey: `isolation-payment:${tag}` } }); paymentIds.push(paymentB.id);
const beforeB = await db.walletAccount.findUnique({ where: { userId_currency: { userId: userB.id, currency: "TRY" } } });
await assert.rejects(db.$transaction(tx => reserveWalletForCheckout(tx, { userId: user.id, orderId: orderB.id, paymentId: paymentB.id, payable: "10.00", currency: "TRY", idempotencyKey: `isolation-reserve:${tag}`, effectiveAt: now })), (e: unknown) => e instanceof StoredValueDomainError && e.code === "STORED_VALUE_OWNERSHIP_REQUIRED");
assert.equal(await db.walletTenderAllocation.count({ where: { orderId: orderB.id } }), 0); assert.equal(await db.walletTransaction.count({ where: { orderId: orderB.id, type: "DEBIT_RESERVED" } }), 0);
assert.equal(await db.walletAccount.findUnique({ where: { userId_currency: { userId: userB.id, currency: "TRY" } } }), beforeB);
// No-wallet checkout regression and seller economics snapshot boundary.
const noWalletOrder = await db.order.create({ data: { userId: user.id, orderNumber: `NO-WALLET-${tag}`, clientRequestId: randomUUID(), totalAmount: "25.00", subtotalAmount: "25.00", externalTenderAmount: "25.00", tenderCurrency: "TRY", recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", walletUse: false } }); orderIds.push(noWalletOrder.id);
const noWalletPayment = await db.payment.create({ data: { orderId: noWalletOrder.id, amount: "25.00", currency: "TRY", provider: "QA", status: "PENDING", idempotencyKey: `no-wallet-payment:${tag}` } }); paymentIds.push(noWalletPayment.id);
const noWalletAccountBefore = await db.walletAccount.findUnique({ where: { userId_currency: { userId: user.id, currency: "TRY" } } });
assert.equal(noWalletOrder.walletUse, false); assert.equal(noWalletOrder.walletTenderAmount.toFixed(2), "0.00"); assert.equal(noWalletOrder.externalTenderAmount.toFixed(2), "25.00"); assert.equal(noWalletPayment.amount.toFixed(2), noWalletOrder.totalAmount.toFixed(2));
assert.equal(await db.walletTransaction.count({ where: { orderId: noWalletOrder.id, type: "DEBIT_RESERVED" } }), 0);
assert.deepEqual(await db.walletAccount.findUnique({ where: { userId_currency: { userId: user.id, currency: "TRY" } } }), noWalletAccountBefore);
const economicSnapshot = { total: order.totalAmount.toFixed(2), subtotal: order.subtotalAmount };
assert.deepEqual({ total: order.totalAmount.toFixed(2), subtotal: order.subtotalAmount }, economicSnapshot);
assert.equal(allocation.walletTenderAmount.add(allocation.externalTenderAmount).toFixed(2), order.totalAmount.toFixed(2));
const identity = await db.$queryRaw<Array<{ database: string; role: string }>>`select current_database() database,current_user role`;
assert.deepEqual(identity[0], { database: TEST_DB_IDENTITY.database, role: "postgres" });
console.log("WALLET_TENDER_DB_PASS");
} finally {
  await db.walletTenderAllocation.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.walletTransaction.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.walletTransaction.deleteMany({ where: { userId: { in: userIds } } });
  await db.walletAccount.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
