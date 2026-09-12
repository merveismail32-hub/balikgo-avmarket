import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { createGuardedTestPrisma, TEST_DB_IDENTITY } from "./guarded-test-prisma";
import { CouponDomainError } from "../app/lib/coupon-domain";
import { createCampaignAccessCoupon, setCampaignAccessCouponLifecycle } from "../app/lib/coupon-access";

const env = hydrateVerifiedTestEnvironment(process.env, process.cwd());
const db = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const prefix = `qa-coupon-${crypto.randomUUID()}`;
const ids = { users: [] as string[], campaigns: [] as string[], coupons: [] as string[], orders: [] as string[] };
const code = (value: string) => (reason: unknown) => reason instanceof CouponDomainError && reason.code === value;

async function main() {
  const identity = await db.$queryRaw<Array<{ database: string; role: string }>>`select current_database() database,current_user role`;
  assert.deepEqual(identity[0], { database: TEST_DB_IDENTITY.database, role: "postgres" });
  const admin = await db.user.create({ data: { name: "QA", surname: "Admin", email: `${prefix}-admin@invalid.local`, phone: "0", passwordHash: "test-only", role: "ADMIN" } });
  const customer = await db.user.create({ data: { name: "QA", surname: "Customer", email: `${prefix}-customer@invalid.local`, phone: "0", passwordHash: "test-only" } });
  ids.users.push(admin.id, customer.id);
  const campaign = await db.campaign.create({ data: { internalName: prefix, status: "PUBLISHED", campaignType: "PERCENTAGE_DISCOUNT", percentage: 10, effectiveFrom: new Date(Date.now() - 60_000), effectiveUntil: new Date(Date.now() + 86_400_000), createdByUserId: admin.id } });
  ids.campaigns.push(campaign.id);
  const payload = (suffix: string) => ({ code: `${prefix}_${suffix}`, name: `Partner ${suffix}`, campaignId: campaign.id, globalRedemptionLimit: 10, perUserRedemptionLimit: 2, reason: "Partner campaign access" });
  const first = await createCampaignAccessCoupon(admin.id, payload("one"), db); ids.coupons.push(first.id);
  const second = await createCampaignAccessCoupon(admin.id, payload("two"), db); ids.coupons.push(second.id);
  assert.equal(first.campaignId, campaign.id); assert.equal(second.campaignId, campaign.id);
  assert.equal(first.accessMode, "CAMPAIGN_ACCESS"); assert.equal(first.discountType, null); assert.equal(first.discountValue, null);
  assert(first.validFrom?.getTime() === campaign.effectiveFrom.getTime() && first.validUntil?.getTime() === campaign.effectiveUntil.getTime());
  await assert.rejects(createCampaignAccessCoupon(admin.id, { ...payload("missing"), campaignId: "missing" }, db), code("COUPON_CAMPAIGN_INVALID"));
  await assert.rejects(createCampaignAccessCoupon(customer.id, payload("forbidden"), db), code("COUPON_FORBIDDEN"));
  await assert.rejects(createCampaignAccessCoupon(admin.id, { ...payload("economic"), discountValue: "10" }, db), code("COUPON_NOT_ELIGIBLE"));

  const legacy = await db.coupon.create({ data: { code: `LEGACY_${crypto.randomUUID().slice(0, 8)}`.toUpperCase(), name: "Legacy", discountType: "FIXED", discountValue: 10 } }); ids.coupons.push(legacy.id);
  assert.equal(legacy.accessMode, "LEGACY_INLINE"); assert.equal(legacy.campaignId, null); assert.equal(legacy.discountValue?.toString(), "10");
  await assert.rejects(db.coupon.create({ data: { code: `BAD_${crypto.randomUUID().slice(0, 8)}`.toUpperCase(), name: "Bad", accessMode: "CAMPAIGN_ACCESS", campaignId: campaign.id, discountType: "FIXED", discountValue: 10, validFrom: campaign.effectiveFrom, validUntil: campaign.effectiveUntil } }));
  await assert.rejects(db.coupon.create({ data: { code: `DANGLE_${crypto.randomUUID().slice(0, 8)}`.toUpperCase(), name: "Dangling", accessMode: "CAMPAIGN_ACCESS", campaignId: "missing", discountType: null, discountValue: null, validFrom: campaign.effectiveFrom, validUntil: campaign.effectiveUntil } }));

  const revoked = await setCampaignAccessCouponLifecycle(admin.id, first.id, { lifecycleStatus: "REVOKED", expectedVersion: 1, reason: "Partner access revoked" }, db);
  assert.equal(revoked.lifecycleStatus, "REVOKED"); assert.equal(revoked.active, false); assert.equal(revoked.version, 2);
  await assert.rejects(setCampaignAccessCouponLifecycle(admin.id, first.id, { lifecycleStatus: "ACTIVE", expectedVersion: 1, reason: "Stale activation" }, db), code("COUPON_STALE_STATE"));
  const active = await setCampaignAccessCouponLifecycle(admin.id, first.id, { lifecycleStatus: "ACTIVE", expectedVersion: 2, reason: "Partner access restored" }, db);
  assert.equal(active.lifecycleStatus, "ACTIVE"); assert.equal(active.version, 3);

  const order = await db.order.create({ data: { userId: customer.id, orderNumber: `COUPON-${crypto.randomUUID()}`, clientRequestId: crypto.randomUUID(), totalAmount: 100, recipientName: "QA", phone: "0", city: "QA", district: "QA", address: "QA foundation address" } }); ids.orders.push(order.id);
  const redemption = await db.couponRedemption.create({ data: { couponId: first.id, userId: customer.id, orderId: order.id, idempotencyKey: `${prefix}:reservation`, state: "RESERVED", couponVersion: active.version, campaignId: campaign.id, discountAmount: 0, consumedAt: null } });
  assert.equal(redemption.state, "RESERVED"); assert.equal(redemption.campaignId, campaign.id); assert.equal(redemption.couponVersion, 3);
  await assert.rejects(db.couponRedemption.create({ data: { couponId: second.id, userId: customer.id, orderId: order.id, idempotencyKey: `${prefix}:other`, state: "RESERVED", couponVersion: 1, campaignId: campaign.id, discountAmount: 0, consumedAt: null } }));
  await assert.rejects(db.couponRedemption.create({ data: { couponId: second.id, userId: customer.id, orderId: order.id, idempotencyKey: `${prefix}:reservation`, state: "RESERVED", couponVersion: 1, campaignId: campaign.id, discountAmount: 0, consumedAt: null } }));
  await assert.rejects(db.couponRedemption.update({ where: { id: redemption.id }, data: { couponVersion: 0 } }));
  await assert.rejects(db.couponRedemption.update({ where: { id: redemption.id }, data: { state: "CONSUMED", consumedAt: null } }));
  assert.equal(await db.adminAuditLog.count({ where: { entityType: "COUPON", entityId: first.id } }), 3);
  console.log("PASS: guarded TEST DB campaign binding, legacy compatibility, lifecycle CAS, FK/check/state/idempotency/same-order constraints");
}

main().finally(async () => {
  await db.couponRedemption.deleteMany({ where: { orderId: { in: ids.orders } } });
  await db.order.deleteMany({ where: { id: { in: ids.orders } } });
  await db.adminAuditLog.deleteMany({ where: { entityType: "COUPON", entityId: { in: ids.coupons } } });
  await db.coupon.deleteMany({ where: { id: { in: ids.coupons } } });
  await db.campaign.deleteMany({ where: { id: { in: ids.campaigns } } });
  await db.user.deleteMany({ where: { id: { in: ids.users } } });
  assert.equal(await db.coupon.count({ where: { id: { in: ids.coupons } } }), 0);
  console.log("PASS: cleanup");
  await db.$disconnect();
});
