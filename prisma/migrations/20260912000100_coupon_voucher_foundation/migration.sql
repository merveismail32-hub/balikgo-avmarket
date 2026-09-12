CREATE TYPE "CouponAccessMode" AS ENUM ('LEGACY_INLINE', 'CAMPAIGN_ACCESS');
CREATE TYPE "CouponLifecycleStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "CouponRedemptionState" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

ALTER TABLE "Coupon"
  ALTER COLUMN "discountType" DROP NOT NULL,
  ALTER COLUMN "discountValue" DROP NOT NULL,
  ADD COLUMN "campaignId" TEXT,
  ADD COLUMN "accessMode" "CouponAccessMode" NOT NULL DEFAULT 'LEGACY_INLINE',
  ADD COLUMN "lifecycleStatus" "CouponLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "validFrom" TIMESTAMPTZ(3),
  ADD COLUMN "validUntil" TIMESTAMPTZ(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "CouponRedemption"
  ADD COLUMN "idempotencyKey" VARCHAR(191),
  ADD COLUMN "state" "CouponRedemptionState" NOT NULL DEFAULT 'CONSUMED',
  ADD COLUMN "couponVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "campaignId" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "consumedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "releasedAt" TIMESTAMP(3);

UPDATE "CouponRedemption"
SET "idempotencyKey" = 'legacy:coupon-redemption:' || "id",
    "consumedAt" = "createdAt";

ALTER TABLE "CouponRedemption" ALTER COLUMN "idempotencyKey" SET NOT NULL;
DROP INDEX "CouponRedemption_couponId_userId_key";

ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "Coupon_usage_limits_check" CHECK (("usageLimit" IS NULL OR "usageLimit" > 0) AND "perUserLimit" > 0),
  ADD CONSTRAINT "Coupon_validity_window_check" CHECK ("validFrom" IS NULL OR "validUntil" IS NULL OR "validFrom" < "validUntil"),
  ADD CONSTRAINT "Coupon_access_mode_check" CHECK (
    ("accessMode" = 'LEGACY_INLINE' AND "campaignId" IS NULL AND "discountType" IS NOT NULL AND "discountValue" IS NOT NULL)
    OR
    ("accessMode" = 'CAMPAIGN_ACCESS' AND "campaignId" IS NOT NULL AND "discountType" IS NULL AND "discountValue" IS NULL AND "maxDiscount" IS NULL AND "minimumAmount" IS NULL AND "validFrom" IS NOT NULL AND "validUntil" IS NOT NULL)
  ),
  ADD CONSTRAINT "Coupon_campaign_access_lifecycle_check" CHECK (
    "accessMode" = 'LEGACY_INLINE'
    OR ("lifecycleStatus" = 'ACTIVE' AND "active" = TRUE)
    OR ("lifecycleStatus" = 'REVOKED' AND "active" = FALSE)
  );

ALTER TABLE "CouponRedemption"
  ADD CONSTRAINT "CouponRedemption_coupon_version_check" CHECK ("couponVersion" > 0),
  ADD CONSTRAINT "CouponRedemption_state_time_check" CHECK (
    ("state" = 'RESERVED' AND "consumedAt" IS NULL AND "releasedAt" IS NULL)
    OR ("state" = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "releasedAt" IS NULL)
    OR ("state" = 'RELEASED' AND "consumedAt" IS NULL AND "releasedAt" IS NOT NULL)
  );

CREATE UNIQUE INDEX "CouponRedemption_idempotencyKey_key" ON "CouponRedemption"("idempotencyKey");
CREATE INDEX "Coupon_campaignId_lifecycleStatus_validFrom_validUntil_idx" ON "Coupon"("campaignId", "lifecycleStatus", "validFrom", "validUntil");
CREATE INDEX "CouponRedemption_couponId_userId_state_idx" ON "CouponRedemption"("couponId", "userId", "state");

ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
