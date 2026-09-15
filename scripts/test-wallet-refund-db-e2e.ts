import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { creditWallet, reserveWalletForCheckout } from "../app/lib/stored-value";
import { captureWalletReservation } from "../app/lib/wallet-tender-lifecycle";
import { finalizeRefundExecution } from "../app/lib/refund-orchestrator";
import { allocateWalletRefund, restoreCapturedWalletForRefund } from "../app/lib/wallet-refund";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const db = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const tag = randomUUID(), now = new Date();
const ids = { users: [] as string[], sellers: [] as string[], products: [] as string[], orders: [] as string[], payments: [] as string[], refunds: [] as string[] };
const money = (value: string) => new Prisma.Decimal(value);

async function main() {
  assert.equal((await db.$queryRaw<Array<{ database: string }>>`select current_database() database`)[0].database, TEST_DB_IDENTITY.database);
  const sellerUser = await db.user.create({ data: { name: "QA", surname: "Seller", email: `${tag}-seller@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER", sellerProfile: { create: { storeName: tag, companyType: "QA", taxNumber: tag, taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } });
  ids.users.push(sellerUser.id); ids.sellers.push(sellerUser.sellerProfile!.id);
  const product = await db.product.create({ data: { sellerId: sellerUser.sellerProfile!.id, name: "QA", slug: `wallet-refund-${tag}`, category: "QA", brand: "QA", price: 1000, stock: 0, description: "QA", imageUrl: "/qa" } }); ids.products.push(product.id);
  const customer = await db.user.create({ data: { name: "QA", surname: "Customer", email: `${tag}@invalid.local`, phone: "0", passwordHash: "qa" } }); ids.users.push(customer.id);
  const order = await db.order.create({ data: { userId: customer.id, orderNumber: `REF-${tag}`, clientRequestId: randomUUID(), subtotalAmount: "1000.00", totalAmount: "1000.00", walletUse: true, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA address", items: { create: { productId: product.id, sellerId: sellerUser.sellerProfile!.id, productName: "QA", productImageUrl: "/qa", unitPrice: "1000.00", quantity: 1, discountAmount: 0, baseUnitPrice: "1000.00", effectiveUnitPrice: "1000.00", finalLineAmount: "1000.00", campaignApplied: false, campaignDiscountAmount: 0, couponApplied: false, couponDiscountAmount: 0, compositionMode: "NONE", discountSource: "NONE", pricingEffectiveAt: now, commissionAmount: "100.00", sellerNetAmount: "900.00" } } }, include: { items: true } }); ids.orders.push(order.id);
  const payment = await db.payment.create({ data: { orderId: order.id, amount: "700.00", currency: "TRY", provider: "QA", providerPaymentId: `provider-${tag}`, status: "PAID", idempotencyKey: `payment-${tag}` } }); ids.payments.push(payment.id);
  await db.$transaction(tx => creditWallet(tx, { userId: customer.id, amount: "300.00", currency: "TRY", fundingSource: "MANUAL_ADJUSTMENT", sourceType: "QA", sourceReference: tag, idempotencyKey: `credit-${tag}`, reason: "QA", effectiveAt: now }));
  const reserved = await db.$transaction(tx => reserveWalletForCheckout(tx, { userId: customer.id, orderId: order.id, paymentId: payment.id, payable: "1000.00", currency: "TRY", idempotencyKey: `reserve-${tag}`, effectiveAt: now }));
  const account = await db.walletAccount.findUniqueOrThrow({ where: { userId_currency: { userId: customer.id, currency: "TRY" } } });
  const allocation = await db.walletTenderAllocation.create({ data: { orderId: order.id, paymentId: payment.id, currency: "TRY", totalCustomerPayable: "1000.00", walletTenderAmount: "300.00", externalTenderAmount: "700.00", walletAccountId: account.id, walletReservationId: reserved.transaction!.id, allocationVersion: "WALLET_TENDER_V1", idempotencyKey: `allocation-${tag}`, semanticHash: "d".repeat(64), effectiveAt: now } });
  await db.$transaction(tx => captureWalletReservation(tx, { paymentId: payment.id, idempotencyKey: `capture-${tag}`, effectiveAt: now, providerReference: `provider-${tag}` }));
  const createRefund = async (amount: string, key = randomUUID()) => { const refund = await db.refund.create({ data: { paymentId: payment.id, orderId: order.id, orderItemId: order.items[0].id, sellerId: sellerUser.sellerProfile!.id, requestedByUserId: customer.id, idempotencyKey: `refund-${key}`, amount, currency: "TRY", reason: "QA", status: "PROCESSING", executionKey: `execution-${key}` } }); ids.refunds.push(refund.id); return refund; };
  const first = await createRefund("200.00"); await db.$transaction(tx => finalizeRefundExecution(tx, { refundId: first.id, result: { outcome: "COMPLETED", providerRefundId: `provider-refund-${first.id}` } }));
  assert.deepEqual(allocateWalletRefund(money("300"), money("700"), money("200")), { wallet: money("60"), external: money("140") });
  const second = await createRefund("300.00"); await db.$transaction(tx => finalizeRefundExecution(tx, { refundId: second.id, result: { outcome: "COMPLETED", providerRefundId: `provider-refund-${second.id}` } }));
  const third = await createRefund("500.00"); await db.$transaction(tx => finalizeRefundExecution(tx, { refundId: third.id, result: { outcome: "COMPLETED", providerRefundId: `provider-refund-${third.id}` } }));
  const credits = await db.walletTransaction.findMany({ where: { refundId: { in: ids.refunds }, type: "REFUND_CREDIT" }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(credits.map(x => x.amount.toFixed(2)), ["60.00", "90.00", "150.00"]);
  assert.deepEqual(allocateWalletRefund(money("300"), money("700"), money("1000")), { wallet: money("300"), external: money("700") });
  await db.$transaction(tx => finalizeRefundExecution(tx, { refundId: third.id, result: { outcome: "COMPLETED", providerRefundId: `provider-refund-${third.id}` } })); assert.equal(await db.walletTransaction.count({ where: { refundId: third.id, type: "REFUND_CREDIT" } }), 1);
  const conflict = await createRefund("1.00", `conflict-${tag}`); assert.equal((await db.$transaction(tx => restoreCapturedWalletForRefund(tx, { refundId: conflict.id }))).outcome, "not-applicable");
  const fullTargets = allocateWalletRefund(money("100"), money("0"), money("100")); assert.equal(fullTargets.wallet.toFixed(2), "100.00"); assert.equal(fullTargets.external.toFixed(2), "0.00");
  const noWalletAccount = await db.walletAccount.findUnique({ where: { userId_currency: { userId: sellerUser.id, currency: "TRY" } } }); assert.equal(noWalletAccount, null);
  const finalAccount = await db.walletAccount.findUniqueOrThrow({ where: { id: account.id } }); assert.equal(credits.reduce((sum, row) => sum.add(row.amount), money("0")).toFixed(2), "300.00"); assert.equal(finalAccount.availableBalance.toFixed(2), "300.00"); assert.equal(finalAccount.reservedBalance.toFixed(2), "0.00"); assert.equal(finalAccount.version, 7); assert.equal(await db.walletTransaction.count({ where: { walletAccountId: account.id } }), 6); assert.equal((await db.walletTenderAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).lifecycleStatus, "CAPTURED");
  console.log("WALLET_REFUND_DB_PASS");
}

async function cleanup() { await db.walletTransaction.deleteMany({ where: { refundId: { in: ids.refunds } } }); await db.refund.deleteMany({ where: { id: { in: ids.refunds } } }); await db.walletTenderAllocation.deleteMany({ where: { orderId: { in: ids.orders } } }); await db.walletTransaction.deleteMany({ where: { userId: { in: ids.users } } }); await db.payment.deleteMany({ where: { id: { in: ids.payments } } }); await db.order.deleteMany({ where: { id: { in: ids.orders } } }); await db.walletAccount.deleteMany({ where: { userId: { in: ids.users } } }); await db.product.deleteMany({ where: { id: { in: ids.products } } }); await db.user.deleteMany({ where: { id: { in: ids.users } } }); }
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { try { await cleanup(); } finally { await db.$disconnect(); } });
