import assert from "node:assert/strict";
import {
  CouponDomainError,
  assertCampaignAccessCouponAvailable,
  assertCouponRedemptionFoundation,
  createCampaignAccessCouponSchema,
  normalizeCampaignAccessCode,
} from "../app/lib/coupon-domain";
import { couponDiscount } from "../app/lib/coupon";
import { Prisma } from "@prisma/client";

const error = (code: string) => (reason: unknown) => reason instanceof CouponDomainError && reason.code === code;
const now = new Date("2026-09-12T12:00:00.000Z");

assert.equal(normalizeCampaignAccessCode("  ismail123  "), "ISMAIL123");
for (const invalid of [null, "", "İSMAİL", "A B", "ab!"]) assert.throws(() => normalizeCampaignAccessCode(invalid), error("COUPON_CODE_INVALID"));
assert.equal(createCampaignAccessCouponSchema.safeParse({ code: "PARTNER_10", name: "Partner", campaignId: "campaign-1", perUserRedemptionLimit: 1, reason: "Partner access" }).success, true);
assert.equal(createCampaignAccessCouponSchema.safeParse({ code: "PARTNER_10", name: "Partner", campaignId: "campaign-1", discountType: "FIXED", discountValue: "10", reason: "Legacy authority attempt" }).success, false);
assert.equal(couponDiscount({ discountType: "FIXED", discountValue: new Prisma.Decimal(10), maxDiscount: null }, new Prisma.Decimal(100)).toFixed(2), "10.00");

const available = { accessMode: "CAMPAIGN_ACCESS", lifecycleStatus: "ACTIVE", active: true, validFrom: new Date("2026-09-12T11:00:00.000Z"), validUntil: new Date("2026-09-12T13:00:00.000Z"), usageLimit: 2, usageCount: 1 } as const;
assert.doesNotThrow(() => assertCampaignAccessCouponAvailable(available, now));
assert.throws(() => assertCampaignAccessCouponAvailable({ ...available, lifecycleStatus: "REVOKED", active: false }, now), error("COUPON_REVOKED"));
assert.throws(() => assertCampaignAccessCouponAvailable({ ...available, active: false }, now), error("COUPON_INACTIVE"));
assert.throws(() => assertCampaignAccessCouponAvailable({ ...available, validFrom: new Date("2026-09-12T12:00:01.000Z") }, now), error("COUPON_NOT_STARTED"));
assert.throws(() => assertCampaignAccessCouponAvailable({ ...available, validUntil: now }, now), error("COUPON_EXPIRED"));
assert.throws(() => assertCampaignAccessCouponAvailable({ ...available, usageCount: 2 }, now), error("COUPON_EXHAUSTED"));
assert.throws(() => assertCampaignAccessCouponAvailable({ ...available, accessMode: "LEGACY_INLINE" }, now), error("COUPON_NOT_ELIGIBLE"));

assert.equal(assertCouponRedemptionFoundation({ couponId: "coupon", userId: "user", orderId: "order", idempotencyKey: "checkout:key", state: "RESERVED", couponVersion: 1, campaignId: "campaign" }).state, "RESERVED");
assert.throws(() => assertCouponRedemptionFoundation({ couponId: "coupon", userId: "user", orderId: "order", idempotencyKey: "", state: "RESERVED", couponVersion: 1, campaignId: "campaign" }), error("COUPON_IDEMPOTENCY_CONFLICT"));

console.log("PASS: #27 coupon access authority, normalization, lifecycle/window/limit errors, legacy-economic rejection and redemption foundation");
