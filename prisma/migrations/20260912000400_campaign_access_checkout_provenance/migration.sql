ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_campaign_checkout_provenance_check";

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_campaign_checkout_provenance_check" CHECK (
    ("compositionMode" IS NULL AND "discountSource" IS NULL AND "baseUnitPrice" IS NULL AND "effectiveUnitPrice" IS NULL AND "finalLineAmount" IS NULL)
    OR
    ("compositionMode" = 'NONE' AND "discountSource" = 'NONE' AND "baseUnitPrice" > 0 AND "effectiveUnitPrice" = "baseUnitPrice" AND "finalLineAmount" = "baseUnitPrice" * "quantity" AND "campaignApplied" = false AND "couponApplied" = false AND "campaignId" IS NULL AND "campaignVersion" IS NULL AND "campaignType" IS NULL AND "campaignDiscountAmount" = 0 AND "couponSnapshotId" IS NULL AND "couponReference" IS NULL AND "couponDiscountAmount" = 0 AND "pricingEffectiveAt" IS NOT NULL)
    OR
    ("compositionMode" = 'CAMPAIGN_ONLY' AND "discountSource" = 'CAMPAIGN' AND "baseUnitPrice" > "effectiveUnitPrice" AND "effectiveUnitPrice" > 0 AND "finalLineAmount" = "effectiveUnitPrice" * "quantity" AND "campaignApplied" = true AND "campaignId" IS NOT NULL AND "campaignVersion" > 0 AND "campaignType" IS NOT NULL AND "campaignDiscountAmount" = ("baseUnitPrice" * "quantity") - "finalLineAmount" AND "campaignDiscountAmount" > 0 AND (("couponApplied" = false AND "couponSnapshotId" IS NULL AND "couponReference" IS NULL AND "couponDiscountAmount" = 0) OR ("couponApplied" = true AND "couponSnapshotId" IS NOT NULL AND "couponReference" IS NOT NULL AND "couponDiscountAmount" = 0)) AND "pricingEffectiveAt" IS NOT NULL)
    OR
    ("compositionMode" = 'COUPON_ONLY' AND "discountSource" = 'COUPON' AND "baseUnitPrice" > 0 AND "effectiveUnitPrice" > 0 AND "finalLineAmount" > 0 AND "finalLineAmount" < "baseUnitPrice" * "quantity" AND "campaignApplied" = false AND "couponApplied" = true AND "campaignId" IS NULL AND "campaignVersion" IS NULL AND "campaignType" IS NULL AND "campaignDiscountAmount" = 0 AND "couponSnapshotId" IS NOT NULL AND "couponReference" IS NOT NULL AND "couponDiscountAmount" = ("baseUnitPrice" * "quantity") - "finalLineAmount" AND "couponDiscountAmount" > 0 AND "pricingEffectiveAt" IS NOT NULL)
  );
