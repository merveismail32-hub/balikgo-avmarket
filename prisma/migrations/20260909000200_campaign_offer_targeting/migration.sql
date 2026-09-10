ALTER TYPE "CampaignAuditAction" ADD VALUE 'CAMPAIGN_TARGET_ADDED';
ALTER TYPE "CampaignAuditAction" ADD VALUE 'CAMPAIGN_TARGET_REMOVED';

CREATE TABLE "CampaignSellerOfferTarget" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "sellerOfferId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignSellerOfferTarget_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CampaignSellerOfferTarget_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CampaignSellerOfferTarget_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CampaignSellerOfferTarget_campaignId_sellerOfferId_key" ON "CampaignSellerOfferTarget"("campaignId", "sellerOfferId");
CREATE INDEX "CampaignSellerOfferTarget_sellerOfferId_campaignId_idx" ON "CampaignSellerOfferTarget"("sellerOfferId", "campaignId");
CREATE INDEX "Campaign_status_effectiveFrom_effectiveUntil_idx" ON "Campaign"("status", "effectiveFrom", "effectiveUntil");
