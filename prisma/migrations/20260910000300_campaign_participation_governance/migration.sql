CREATE TYPE "CampaignParticipationStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED');
CREATE TYPE "CampaignParticipationAuditAction" AS ENUM ('PARTICIPATION_REQUESTED', 'PARTICIPATION_CANCELLED', 'PARTICIPATION_APPROVED', 'PARTICIPATION_REJECTED', 'PARTICIPATION_REVOKED');

CREATE TABLE "CampaignParticipation" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "sellerOfferId" TEXT NOT NULL,
  "status" "CampaignParticipationStatus" NOT NULL DEFAULT 'REQUESTED',
  "activeKey" VARCHAR(191),
  "version" INTEGER NOT NULL DEFAULT 1,
  "decisionReason" VARCHAR(500),
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignParticipation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CampaignParticipation_version_check" CHECK ("version" > 0),
  CONSTRAINT "CampaignParticipation_active_key_check" CHECK (("status" IN ('REQUESTED', 'APPROVED') AND "activeKey" IS NOT NULL) OR ("status" IN ('REJECTED', 'CANCELLED', 'REVOKED') AND "activeKey" IS NULL))
);

CREATE TABLE "CampaignParticipationAudit" (
  "id" TEXT NOT NULL,
  "participationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "sellerOfferId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorRole" "UserRole" NOT NULL,
  "action" "CampaignParticipationAuditAction" NOT NULL,
  "previousStatus" "CampaignParticipationStatus",
  "newStatus" "CampaignParticipationStatus" NOT NULL,
  "expectedVersion" INTEGER,
  "previousVersion" INTEGER,
  "newVersion" INTEGER NOT NULL,
  "reason" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignParticipationAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CampaignParticipationAudit_version_check" CHECK ("newVersion" > 0)
);

CREATE UNIQUE INDEX "CampaignParticipation_activeKey_key" ON "CampaignParticipation"("activeKey");
CREATE INDEX "CampaignParticipation_campaignId_status_createdAt_idx" ON "CampaignParticipation"("campaignId", "status", "createdAt");
CREATE INDEX "CampaignParticipation_sellerId_status_createdAt_idx" ON "CampaignParticipation"("sellerId", "status", "createdAt");
CREATE INDEX "CampaignParticipation_sellerOfferId_status_createdAt_idx" ON "CampaignParticipation"("sellerOfferId", "status", "createdAt");
CREATE UNIQUE INDEX "CampaignParticipationAudit_participationId_newVersion_key" ON "CampaignParticipationAudit"("participationId", "newVersion");
CREATE INDEX "CampaignParticipationAudit_campaignId_createdAt_idx" ON "CampaignParticipationAudit"("campaignId", "createdAt");
CREATE INDEX "CampaignParticipationAudit_sellerId_createdAt_idx" ON "CampaignParticipationAudit"("sellerId", "createdAt");

ALTER TABLE "CampaignParticipation" ADD CONSTRAINT "CampaignParticipation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignParticipation" ADD CONSTRAINT "CampaignParticipation_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignParticipation" ADD CONSTRAINT "CampaignParticipation_sellerId_sellerOfferId_fkey" FOREIGN KEY ("sellerId", "sellerOfferId") REFERENCES "SellerOffer"("sellerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignParticipationAudit" ADD CONSTRAINT "CampaignParticipationAudit_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "CampaignParticipation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignParticipationAudit" ADD CONSTRAINT "CampaignParticipationAudit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignParticipationAudit" ADD CONSTRAINT "CampaignParticipationAudit_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignParticipationAudit" ADD CONSTRAINT "CampaignParticipationAudit_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignParticipationAudit" ADD CONSTRAINT "CampaignParticipationAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
