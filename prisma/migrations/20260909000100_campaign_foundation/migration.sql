CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');
CREATE TYPE "CampaignType" AS ENUM ('PERCENTAGE_DISCOUNT', 'FIXED_AMOUNT_DISCOUNT', 'FIXED_PROMOTIONAL_PRICE');
CREATE TYPE "CampaignAuditAction" AS ENUM ('CAMPAIGN_CREATED', 'CAMPAIGN_UPDATED', 'CAMPAIGN_PUBLISHED', 'CAMPAIGN_CANCELLED');
CREATE TABLE "Campaign" (
 "id" TEXT PRIMARY KEY, "internalName" VARCHAR(200) NOT NULL,
 "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT', "campaignType" "CampaignType" NOT NULL,
 "percentage" DECIMAL(5,2), "fixedAmount" DECIMAL(12,2), "fixedPrice" DECIMAL(12,2),
 "effectiveFrom" TIMESTAMPTZ(3) NOT NULL, "effectiveUntil" TIMESTAMPTZ(3) NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1, "createdByUserId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "Campaign_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "Campaign_version_check" CHECK ("version" > 0),
 CONSTRAINT "Campaign_window_check" CHECK ("effectiveFrom" < "effectiveUntil"),
 CONSTRAINT "Campaign_rule_check" CHECK (
 ("campaignType" = 'PERCENTAGE_DISCOUNT' AND "percentage" IS NOT NULL AND "percentage" > 0 AND "percentage" < 100 AND "fixedAmount" IS NULL AND "fixedPrice" IS NULL) OR
 ("campaignType" = 'FIXED_AMOUNT_DISCOUNT' AND "fixedAmount" IS NOT NULL AND "fixedAmount" > 0 AND "percentage" IS NULL AND "fixedPrice" IS NULL) OR
 ("campaignType" = 'FIXED_PROMOTIONAL_PRICE' AND "fixedPrice" IS NOT NULL AND "fixedPrice" > 0 AND "percentage" IS NULL AND "fixedAmount" IS NULL))
);
CREATE TABLE "CampaignAudit" (
 "id" TEXT PRIMARY KEY, "campaignId" TEXT NOT NULL, "actorUserId" TEXT NOT NULL, "actorRole" "UserRole" NOT NULL,
 "action" "CampaignAuditAction" NOT NULL, "previousVersion" INTEGER, "newVersion" INTEGER NOT NULL,
 "previousState" JSONB, "newState" JSONB NOT NULL, "reason" VARCHAR(500) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CampaignAudit_campaign_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CampaignAudit_actor_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CampaignAudit_version_check" CHECK (("action" = 'CAMPAIGN_CREATED' AND "previousVersion" IS NULL AND "newVersion" = 1 AND "previousState" IS NULL) OR ("action" <> 'CAMPAIGN_CREATED' AND "previousVersion" IS NOT NULL AND "previousVersion" > 0 AND "newVersion" = "previousVersion" + 1 AND "previousState" IS NOT NULL)),
 CONSTRAINT "CampaignAudit_actor_check" CHECK ("actorRole" = 'ADMIN' AND length(trim("reason")) >= 3)
);
CREATE UNIQUE INDEX "CampaignAudit_campaignId_newVersion_key" ON "CampaignAudit"("campaignId", "newVersion");
CREATE INDEX "CampaignAudit_campaignId_createdAt_idx" ON "CampaignAudit"("campaignId", "createdAt");
