import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { claimExpiredPayments, expireClaimedPayment, runPaymentExpiryBatch } from "../app/lib/payment-expiry";
import { processVerifiedPaymentEvent } from "../app/lib/payment-orchestrator";

const prisma = createGuardedTestPrisma();
const ids = { users: [] as string[], sellers: [] as string[], catalogs: [] as string[], products: [] as string[], offers: [] as string[], orders: [] as string[], payments: [] as string[], coupons: [] as string[] };
const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };

async function fixture(input: { expiresAt: Date; status?: "PENDING" | "AUTHORIZED"; stockState?: "RESERVED" | "RELEASED"; itemStatus?: "NEW" | "PREPARING"; coupon?: boolean } ) {
  const key = randomUUID();
  const user = await prisma.user.create({ data: { name: "Expiry", surname: "QA", email: `expiry-c-${key}@invalid.local`, phone: "0", passwordHash: "qa" } }); ids.users.push(user.id);
  const sellerUser = await prisma.user.create({ data: { name: "Expiry", surname: "Seller", email: `expiry-s-${key}@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER", sellerProfile: { create: { storeName: `expiry-${key}`, storeSlug: `expiry-${key}`, companyType: "QA", taxNumber: key, taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } }); ids.users.push(sellerUser.id); ids.sellers.push(sellerUser.sellerProfile!.id);
  const catalog = await prisma.catalogProduct.create({ data: { slug: `expiry-c-${key}`, identityKey: `expiry:${key}`, name: "Expiry", category: "QA", brand: "QA", description: "QA", imageUrl: "/qa" } }); ids.catalogs.push(catalog.id);
  const product = await prisma.product.create({ data: { sellerId: sellerUser.sellerProfile!.id, catalogProductId: catalog.id, name: "Expiry", slug: `expiry-p-${key}`, category: "QA", brand: "QA", price: 100, stock: 0, description: "QA", imageUrl: "/qa" } }); ids.products.push(product.id);
  const offer = await prisma.sellerOffer.create({ data: { sellerId: sellerUser.sellerProfile!.id, catalogProductId: catalog.id, legacyProductId: product.id, sellerSku: `E-${key}`, price: 100, stock: 0 } }); ids.offers.push(offer.id);
  const coupon = input.coupon ? await prisma.coupon.create({ data: { code: `E${key.replaceAll("-", "").slice(0, 20)}`, name: "Expiry", discountType: "FIXED", discountValue: 10, usageCount: 1 } }) : null; if (coupon) ids.coupons.push(coupon.id);
  const order = await prisma.order.create({ data: { userId: user.id, orderNumber: `E-${key}`, clientRequestId: randomUUID(), totalAmount: 100, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", couponId: coupon?.id, couponCode: coupon?.code, items: { create: { productId: product.id, catalogProductId: catalog.id, sellerOfferId: offer.id, sellerId: sellerUser.sellerProfile!.id, productName: "Expiry", productImageUrl: "/qa", unitPrice: 100, quantity: 1, status: input.itemStatus ?? "NEW", commissionAmount: 10, sellerNetAmount: 90, stockReservationState: input.stockState ?? "RESERVED" } } }, include: { items: true } }); ids.orders.push(order.id);
  if (coupon) await prisma.couponRedemption.create({ data: { couponId: coupon.id, userId: user.id, orderId: order.id, discountAmount: 10 } });
  const payment = await prisma.payment.create({ data: { orderId: order.id, amount: 100, provider: "TEST_PENDING", status: input.status ?? "PENDING", reservationExpiresAt: input.expiresAt } }); ids.payments.push(payment.id);
  const payout = await prisma.sellerPayout.create({ data: { sellerId: sellerUser.sellerProfile!.id, orderId: order.id, orderItemId: order.items[0].id, grossAmount: 100, commissionAmount: 10, netAmount: 90 } });
  await prisma.financialLedgerEntry.createMany({ data: [{ sellerId: sellerUser.sellerProfile!.id, orderItemId: order.items[0].id, payoutId: payout.id, type: "SALE", amount: 100 }, { sellerId: sellerUser.sellerProfile!.id, orderItemId: order.items[0].id, payoutId: payout.id, type: "COMMISSION", amount: 10 }] });
  return { user, sellerUser, order, payment, offer, coupon };
}

const paidEvent = (payment: { id: string; amount: Prisma.Decimal }, eventId = randomUUID()) => ({ provider: "TEST", event: { eventId: `expiry-${eventId}`, paymentId: payment.id, eventType: "PAYMENT_PAID" as const, amount: payment.amount.toString(), currency: "TRY" as const }, payloadHash: "expiry-e2e" });

async function cleanup() {
  const reviews = await prisma.paymentReconciliationReview.findMany({ where: { paymentId: { in: ids.payments } }, select: { id: true } });
  const movements = await prisma.stockMovement.findMany({ where: { orderId: { in: ids.orders } }, select: { id: true } });
  const notifications = await prisma.notification.findMany({ where: { orderId: { in: ids.orders } }, select: { id: true } });
  const audits = await prisma.financialAuditEvent.findMany({ where: { orderId: { in: ids.orders } }, select: { id: true } });
  const ledger = await prisma.financialLedgerEntry.findMany({ where: { orderItem: { orderId: { in: ids.orders } } }, select: { id: true } });
  const payouts = await prisma.sellerPayout.findMany({ where: { orderId: { in: ids.orders } }, select: { id: true } });
  const events = await prisma.paymentEvent.findMany({ where: { paymentId: { in: ids.payments } }, select: { id: true } });
  const redemptions = await prisma.couponRedemption.findMany({ where: { orderId: { in: ids.orders } }, select: { id: true } });
  const remove = async (rows: { id: string }[], fn: (values: string[]) => Promise<unknown>) => { if (rows.length) await fn(rows.map((row) => row.id)); };
  await remove(reviews, (v) => prisma.paymentReconciliationReview.deleteMany({ where: { id: { in: v } } }));
  await remove(movements, (v) => prisma.stockMovement.deleteMany({ where: { id: { in: v } } }));
  await remove(notifications, (v) => prisma.notification.deleteMany({ where: { id: { in: v } } }));
  await remove(audits, (v) => prisma.financialAuditEvent.deleteMany({ where: { id: { in: v } } }));
  await remove(ledger, (v) => prisma.financialLedgerEntry.deleteMany({ where: { id: { in: v } } }));
  await remove(payouts, (v) => prisma.sellerPayout.deleteMany({ where: { id: { in: v } } }));
  await remove(events, (v) => prisma.paymentEvent.deleteMany({ where: { id: { in: v } } }));
  await remove(redemptions, (v) => prisma.couponRedemption.deleteMany({ where: { id: { in: v } } }));
  if (ids.payments.length) await prisma.payment.deleteMany({ where: { id: { in: ids.payments } } }); if (ids.orders.length) await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }); if (ids.offers.length) await prisma.sellerOffer.deleteMany({ where: { id: { in: ids.offers } } }); if (ids.products.length) await prisma.product.deleteMany({ where: { id: { in: ids.products } } }); if (ids.catalogs.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: ids.catalogs } } }); if (ids.coupons.length) await prisma.coupon.deleteMany({ where: { id: { in: ids.coupons } } }); if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } }); if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  assert((await prisma.payment.count({ where: { id: { in: ids.payments } } })) === 0 && (await prisma.user.count({ where: { id: { in: ids.users } } })) === 0, "EXACT_ID_CLEANUP_FAILED");
}

async function main() {
  const identity = await prisma.$queryRaw<Array<{ database: string; role: string }>>`select current_database() database,current_user role`; assert(identity[0]?.database === TEST_DB_IDENTITY.database && identity[0]?.role === "postgres", "TEST_IDENTITY_MISMATCH");
  const now = new Date();
  const future = await fixture({ expiresAt: new Date(now.getTime() + 60_000) }); assert((await claimExpiredPayments(prisma, { now })).every((x) => x.id !== future.payment.id), "FUTURE_PAYMENT_CLAIMED");
  const pending = await fixture({ expiresAt: new Date(now.getTime() - 60_000), coupon: true }); const authorized = await fixture({ expiresAt: new Date(now.getTime() - 30_000), status: "AUTHORIZED" });
  const concurrent = await Promise.all([claimExpiredPayments(prisma, { now }), claimExpiredPayments(prisma, { now })]); const claimedIds = concurrent.flat().map((x) => x.id); assert(new Set(claimedIds).size === claimedIds.length && claimedIds.includes(pending.payment.id) && claimedIds.includes(authorized.payment.id), "CONCURRENT_CLAIM_DUPLICATE");
  for (const claim of concurrent.flat()) await prisma.$transaction((tx) => expireClaimedPayment(tx, claim, now));
  const expired = await prisma.payment.findUniqueOrThrow({ where: { id: pending.payment.id }, include: { order: { include: { items: true } } } }); assert(expired.status === "EXPIRED" && expired.order.status === "CANCELLED" && expired.order.items.every((x) => x.status === "CANCELLED" && x.stockReservationState === "RELEASED"), "NORMAL_EXPIRY_FAILED"); assert(await prisma.stockMovement.count({ where: { orderId: pending.order.id, type: "RESERVATION_RELEASE" } }) === 1, "EXPIRY_RELEASE_NOT_EXACTLY_ONCE"); assert((await prisma.coupon.findUniqueOrThrow({ where: { id: pending.coupon!.id } })).usageCount === 0, "COUPON_NOT_RESTORED");
  await Promise.allSettled(Array.from({ length: 10 }, () => prisma.$transaction((tx) => processVerifiedPaymentEvent(tx, paidEvent(pending.payment))))); assert(await prisma.paymentReconciliationReview.count({ where: { paymentId: pending.payment.id, status: "PENDING", reason: "LATE_PAYMENT_SUCCESS" } }) === 1, "LATE_PAID_REVIEW_NOT_IDEMPOTENT"); assert((await prisma.payment.findUniqueOrThrow({ where: { id: pending.payment.id } })).status === "EXPIRED", "LATE_PAID_REVIVED");
  const conflict = await fixture({ expiresAt: new Date(now.getTime() - 10_000), itemStatus: "PREPARING" }); const conflictClaim = (await claimExpiredPayments(prisma, { now })).find((x) => x.id === conflict.payment.id)!; await prisma.$transaction((tx) => expireClaimedPayment(tx, conflictClaim, now)); assert((await prisma.payment.findUniqueOrThrow({ where: { id: conflict.payment.id } })).status === "PENDING" && await prisma.stockMovement.count({ where: { orderId: conflict.order.id } }) === 0 && await prisma.paymentReconciliationReview.count({ where: { paymentId: conflict.payment.id, reason: "EXPIRY_FULFILLMENT_CONFLICT" } }) === 1, "FULFILLMENT_CONFLICT_UNSAFE");
  const batchA = await fixture({ expiresAt: new Date(now.getTime() - 5_000) }); const batchB = await fixture({ expiresAt: new Date(now.getTime() - 4_000) }); const batch = await runPaymentExpiryBatch(prisma, { now, limit: 25 }); assert(batch.claimed >= 2 && batch.expired >= 2, "BATCH_DID_NOT_CONTINUE"); assert((await prisma.payment.findUniqueOrThrow({ where: { id: batchA.payment.id } })).status === "EXPIRED" && (await prisma.payment.findUniqueOrThrow({ where: { id: batchB.payment.id } })).status === "EXPIRED", "BATCH_EXPIRY_FAILED");
  console.log("PASS: guarded Payment expiry claims, concurrency, compensation, late review, conflict and batch isolation verified.");
}

main().finally(async () => { await cleanup(); await prisma.$disconnect(); });
