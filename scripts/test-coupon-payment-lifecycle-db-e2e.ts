import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";

Object.assign(process.env, hydrateVerifiedTestEnvironment(process.env, process.cwd()));
const db = createGuardedTestPrisma();
const prefix = `qa-e-${randomUUID()}`;
const ids = { users: [] as string[], orders: [] as string[], coupons: [] as string[], campaigns: [] as string[], products: [] as string[] };

async function main() {
  const { reserveCoupon } = await import("../app/lib/coupon-access");
  const { processPaymentCallback, processVerifiedPaymentEvent } = await import("../app/lib/payment-orchestrator");
  const { expireClaimedPayment } = await import("../app/lib/payment-expiry");
  const { cancelOrderItem } = await import("../app/lib/order-orchestrator");
  const { detectPaymentReconciliation } = await import("../app/lib/payment-reconciliation-service");
  assert.equal((await db.$queryRaw<Array<{ database: string }>>`select current_database() database`)[0].database, TEST_DB_IDENTITY.database);
  const user = await db.user.create({ data: { name: "QA", surname: "Coupon", email: `${prefix}@invalid.local`, phone: "0", passwordHash: "qa" } }); ids.users.push(user.id);
  const seller = await db.user.create({ data: { name: "QA", surname: "Seller", email: `${prefix}-s@invalid.local`, phone: "0", passwordHash: "qa", role: "SELLER", sellerProfile: { create: { storeName: prefix, companyType: "QA", taxNumber: prefix, taxOffice: "QA", city: "QA", address: "QA", description: "QA", status: "APPROVED" } } }, include: { sellerProfile: true } }); ids.users.push(seller.id);
  const product = await db.product.create({ data: { sellerId: seller.sellerProfile!.id, name: "QA", slug: prefix, category: "QA", brand: "QA", price: 100, stock: 0, description: "QA", imageUrl: "/qa" } }); ids.products.push(product.id);
  const campaign = await db.campaign.create({ data: { internalName: prefix, status: "PUBLISHED", campaignType: "PERCENTAGE_DISCOUNT", percentage: 10, effectiveFrom: new Date(Date.now() - 3600000), effectiveUntil: new Date(Date.now() + 86400000), createdByUserId: user.id } }); ids.campaigns.push(campaign.id);
  async function fixture(mode: "access" | "legacy" | "none" = "access", quantity = 1) {
    const coupon = mode === "none" ? null : await db.coupon.create({ data: mode === "legacy" ? { code: randomUUID().toUpperCase(), name: "QA", discountType: "FIXED", discountValue: 10, usageCount: 1 } : { code: randomUUID().toUpperCase(), name: "QA", accessMode: "CAMPAIGN_ACCESS", campaignId: campaign.id, validFrom: campaign.effectiveFrom, validUntil: campaign.effectiveUntil, usageLimit: 1, perUserLimit: 1 } });
    if (coupon) ids.coupons.push(coupon.id);
    const order = await db.order.create({ data: { userId: user.id, orderNumber: randomUUID(), clientRequestId: randomUUID(), totalAmount: 90 * quantity, couponId: coupon?.id, couponCode: coupon?.code, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA", items: { create: Array.from({ length: quantity }, () => ({ productId: product.id, sellerId: seller.sellerProfile!.id, productName: "QA", productImageUrl: "/qa", unitPrice: 100, quantity: 1, discountAmount: 10, stockReservationState: "RESERVED" as const, baseUnitPrice: 100, effectiveUnitPrice: 90, finalLineAmount: 90, campaignApplied: true, campaignId: campaign.id, campaignVersion: 1, campaignType: "PERCENTAGE_DISCOUNT" as const, campaignDiscountAmount: 10, couponApplied: mode === "access", couponSnapshotId: mode === "access" ? coupon!.id : null, couponReference: mode === "access" ? coupon!.code : null, couponDiscountAmount: 0, compositionMode: "CAMPAIGN_ONLY" as const, discountSource: "CAMPAIGN" as const, pricingEffectiveAt: new Date() })) } }, include: { items: true } }); ids.orders.push(order.id);
    if (coupon) {
      if (mode === "access") await db.$transaction(tx => reserveCoupon(tx, { couponCode: coupon.code, userId: user.id, orderId: order.id, idempotencyKey: randomUUID(), effectiveAt: order.createdAt }));
      else await db.couponRedemption.create({ data: { couponId: coupon.id, userId: user.id, orderId: order.id, discountAmount: 10 } });
    }
    const token = randomUUID();
    const payment = await db.payment.create({ data: { orderId: order.id, amount: order.totalAmount, provider: "TEST_PENDING", reservationExpiresAt: new Date(Date.now() - 60000), expiryClaimToken: token, expiryClaimExpiresAt: new Date(Date.now() + 3600000) } });
    return { coupon, order, payment, claim: { id: payment.id, expiryClaimToken: token } };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const event = (f: Fixture, eventType: "PAYMENT_PAID" | "PAYMENT_FAILED", eventId = randomUUID()) => ({ provider: "TEST", event: { eventId, paymentId: f.payment.id, eventType, amount: f.payment.amount.toString(), currency: "TRY" } });
  async function snapshot(f: Fixture) {
    return { payment: await db.payment.findUniqueOrThrow({ where: { id: f.payment.id } }), order: await db.order.findUniqueOrThrow({ where: { id: f.order.id }, include: { items: { orderBy: { id: "asc" } } } }), coupon: f.coupon && await db.coupon.findUniqueOrThrow({ where: { id: f.coupon.id } }), redemption: await db.couponRedemption.findUnique({ where: { orderId: f.order.id } }), audits: await db.couponRedemptionAudit.findMany({ where: { orderId: f.order.id }, orderBy: { id: "asc" } }), events: await db.paymentEvent.count({ where: { paymentId: f.payment.id } }), financial: await db.financialAuditEvent.count({ where: { orderId: f.order.id } }), notifications: await db.notification.count({ where: { orderId: f.order.id } }), product: await db.product.findUniqueOrThrow({ where: { id: product.id } }) };
  }
  async function verify(f: Fixture, state: "CONSUMED" | "RELEASED", paymentStatus?: string) {
    const current = await snapshot(f);
    assert.equal(current.redemption?.state, state);
    assert.equal(current.coupon?.usageCount, state === "CONSUMED" ? 1 : 0);
    assert.equal(current.audits.length, 2);
    assert.equal(current.audits.filter(a => a.nextState === state).length, 1);
    if (paymentStatus) assert.equal(current.payment.status, paymentStatus);
    for (const item of current.order.items) {
      const original = f.order.items.find(x => x.id === item.id)!;
      for (const key of ["unitPrice", "discountAmount", "campaignId", "campaignVersion", "campaignType", "campaignDiscountAmount", "couponReference", "couponSnapshotId", "finalLineAmount", "pricingEffectiveAt"] as const) assert.deepEqual(item[key], original[key]);
    }
    assert.equal(current.redemption?.couponVersion, 1);
    assert.equal(current.redemption?.campaignId, campaign.id);
    assert.equal(current.redemption?.userId, user.id);
    return current;
  }
  const paid = await fixture(); const success = event(paid, "PAYMENT_PAID");
  await Promise.all([processPaymentCallback(db, success), processPaymentCallback(db, success)]);
  await processPaymentCallback(db, event(paid, "PAYMENT_PAID")); await verify(paid, "CONSUMED", "PAID");
  console.log("PASS: concurrent duplicate success + distinct replay: one consume, usage=1, immutable provenance");
  const failed = await fixture(); const failure = event(failed, "PAYMENT_FAILED");
  await Promise.all([processPaymentCallback(db, failure), processPaymentCallback(db, failure)]);
  await processPaymentCallback(db, event(failed, "PAYMENT_FAILED")); await verify(failed, "RELEASED", "FAILED");
  const expired = await fixture();
  await Promise.all([db.$transaction(tx => expireClaimedPayment(tx, expired.claim)), db.$transaction(tx => expireClaimedPayment(tx, expired.claim))]);
  await verify(expired, "RELEASED", "EXPIRED");
  console.log("PASS: duplicate failure/expiry: one release, usage=0");
  const cancelled = await fixture("access", 2);
  const cancel = (id: string) => db.$transaction(tx => cancelOrderItem(tx, { orderItemId: id, actor: { kind: "CUSTOMER", userId: user.id } }));
  await cancel(cancelled.order.items[0].id);
  assert.equal((await snapshot(cancelled)).redemption?.state, "RESERVED");
  await Promise.all([cancel(cancelled.order.items[1].id), cancel(cancelled.order.items[1].id)]);
  assert.equal((await verify(cancelled, "RELEASED", "PENDING")).order.status, "CANCELLED");
  await processPaymentCallback(db, event(cancelled, "PAYMENT_PAID")); await verify(cancelled, "RELEASED", "PENDING");
  console.log("PASS: partial cancellation retains reservation; terminal pre-payment cancellation releases once; late success review");
  for (const kind of ["failure", "expiry", "cancel"] as const) {
    const f = await fixture();
    await Promise.all([processPaymentCallback(db, event(f, "PAYMENT_PAID")), kind === "failure" ? processPaymentCallback(db, event(f, "PAYMENT_FAILED")) : kind === "expiry" ? db.$transaction(tx => expireClaimedPayment(tx, f.claim)) : cancel(f.order.items[0].id)]);
    const result = await snapshot(f);
    const consumed = ["PAID", "REFUND_PENDING", "PARTIAL_REFUND_PENDING"].includes(result.payment.status);
    await verify(f, consumed ? "CONSUMED" : "RELEASED");
    console.log(`PASS: success/${kind} race: payment=${result.payment.status}, coupon=${result.redemption?.state}, usage=${result.coupon?.usageCount}`);
  }
  const reconcile = await fixture();
  const observed = { status: "SUCCEEDED" as const, amount: "90", currency: "TRY", orderId: reconcile.order.id };
  const detection = await db.$transaction(tx => detectPaymentReconciliation(tx, { paymentId: reconcile.payment.id, observed, detectedBy: "QA" }));
  assert.equal(detection.decision, "REPLAY_ORCHESTRATION");
  await processPaymentCallback(db, event(reconcile, "PAYMENT_PAID")); await verify(reconcile, "CONSUMED", "PAID");
  for (const f of [failed, expired]) {
    const result = await db.$transaction(tx => detectPaymentReconciliation(tx, { paymentId: f.payment.id, observed: { ...observed, orderId: f.order.id }, detectedBy: "QA" }));
    assert.equal(result.decision, "REQUIRE_MANUAL_REVIEW");
    await processPaymentCallback(db, event(f, "PAYMENT_PAID")); await verify(f, "RELEASED");
  }
  await processPaymentCallback(db, event(paid, "PAYMENT_FAILED")); await verify(paid, "CONSUMED", "PAID");
  console.log("PASS: reconciliation replay consumes pending; terminal late/conflicting events preserve coupon truth");
  for (const kind of ["success", "failure", "expiry", "cancel"] as const) {
    const f = await fixture(); const before = await snapshot(f); const sentinel = new Error("FORCED_ROLLBACK");
    await assert.rejects(db.$transaction(async tx => {
      if (kind === "expiry") await expireClaimedPayment(tx, f.claim);
      else if (kind === "cancel") await cancelOrderItem(tx, { orderItemId: f.order.items[0].id, actor: { kind: "CUSTOMER", userId: user.id } });
      else await processVerifiedPaymentEvent(tx, event(f, kind === "success" ? "PAYMENT_PAID" : "PAYMENT_FAILED"));
      throw sentinel;
    }), e => e === sentinel);
    assert.deepEqual(await snapshot(f), before);
  }
  console.log("PASS: forced success/failure/expiry/cancel rollback: payment/order/coupon/counter/audit/event/notification/stock unchanged");
  for (const mode of ["legacy", "none"] as const) for (const type of ["PAYMENT_PAID", "PAYMENT_FAILED"] as const) {
    const f = await fixture(mode); await processPaymentCallback(db, event(f, type));
    const result = await snapshot(f); assert.equal(result.payment.status, type === "PAYMENT_PAID" ? "PAID" : "FAILED");
    if (mode === "legacy") { assert.equal(result.coupon?.usageCount, type === "PAYMENT_PAID" ? 1 : 0); assert.equal(result.redemption?.state ?? null, type === "PAYMENT_PAID" ? "CONSUMED" : null); }
    else assert.equal(result.redemption, null);
  }
  console.log("PASS: legacy/non-coupon payment regression");
}

async function cleanup() {
  const where = { orderId: { in: ids.orders } };
  await db.couponRedemptionAudit.deleteMany({ where });
  await db.couponRedemption.deleteMany({ where });
  await db.refund.deleteMany({ where });
  await db.paymentReconciliationReview.deleteMany({ where: { payment: where } });
  await db.order.deleteMany({ where: { id: { in: ids.orders } } });
  await db.coupon.deleteMany({ where: { id: { in: ids.coupons } } });
  await db.campaign.deleteMany({ where: { id: { in: ids.campaigns } } });
  await db.product.deleteMany({ where: { id: { in: ids.products } } });
  await db.user.deleteMany({ where: { id: { in: ids.users } } });
  assert.equal(await db.order.count({ where: { id: { in: ids.orders } } }), 0);
  assert.equal(await db.couponRedemptionAudit.count({ where }), 0);
  assert.equal(await db.coupon.count({ where: { id: { in: ids.coupons } } }), 0);
  console.log("PASS: exact fixture cleanup");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { try { await cleanup(); } finally { await db.$disconnect(); } });
