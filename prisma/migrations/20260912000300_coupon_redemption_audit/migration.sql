CREATE TABLE "CouponRedemptionAudit" (
  "id" TEXT NOT NULL,
  "redemptionId" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "campaignId" TEXT,
  "userId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(191) NOT NULL,
  "previousState" "CouponRedemptionState",
  "nextState" "CouponRedemptionState" NOT NULL,
  "couponVersion" INTEGER NOT NULL,
  "reason" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponRedemptionAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CouponRedemptionAudit_version_check" CHECK ("couponVersion" > 0)
);
CREATE UNIQUE INDEX "CouponRedemptionAudit_redemptionId_nextState_key" ON "CouponRedemptionAudit"("redemptionId", "nextState");
CREATE INDEX "CouponRedemptionAudit_couponId_createdAt_idx" ON "CouponRedemptionAudit"("couponId", "createdAt");
CREATE INDEX "CouponRedemptionAudit_userId_createdAt_idx" ON "CouponRedemptionAudit"("userId", "createdAt");
CREATE INDEX "CouponRedemptionAudit_orderId_createdAt_idx" ON "CouponRedemptionAudit"("orderId", "createdAt");
ALTER TABLE "CouponRedemptionAudit" ADD CONSTRAINT "CouponRedemptionAudit_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "CouponRedemption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouponRedemptionAudit" ADD CONSTRAINT "CouponRedemptionAudit_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouponRedemptionAudit" ADD CONSTRAINT "CouponRedemptionAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouponRedemptionAudit" ADD CONSTRAINT "CouponRedemptionAudit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
