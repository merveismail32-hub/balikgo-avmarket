ALTER TABLE "CampaignAudit" ADD COLUMN "sellerOfferId" TEXT;
ALTER TABLE "CampaignAudit" ADD CONSTRAINT "CampaignAudit_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CampaignAudit_sellerOfferId_createdAt_idx" ON "CampaignAudit"("sellerOfferId", "createdAt");
