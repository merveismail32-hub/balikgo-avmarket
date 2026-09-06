CREATE TYPE "InstallmentCommercialPolicyScope" AS ENUM ('GLOBAL','SELLER','CATEGORY','SELLER_CATEGORY','SELLER_OFFER');
CREATE TABLE "InstallmentCommercialPolicy" (
 "id" TEXT NOT NULL,"scopeType" "InstallmentCommercialPolicyScope" NOT NULL,"scopeKey" VARCHAR(191) NOT NULL,"sellerId" TEXT,"categoryId" TEXT,"sellerOfferId" TEXT,
 "allowedInstallments" JSONB NOT NULL,"minimumEligibleAmount" DECIMAL(12,2) NOT NULL,"maximumEligibleAmount" DECIMAL(12,2),"effectiveFrom" TIMESTAMP(3) NOT NULL,"effectiveUntil" TIMESTAMP(3),
 "version" INTEGER NOT NULL DEFAULT 1,"approvedFromRequestId" TEXT,"reason" VARCHAR(500) NOT NULL,"createdByUserId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "InstallmentCommercialPolicy_pkey" PRIMARY KEY("id"),
 CONSTRAINT "InstallmentCommercialPolicy_version_check" CHECK("version">=1),
 CONSTRAINT "InstallmentCommercialPolicy_allowed_check" CHECK(jsonb_typeof("allowedInstallments")='array' AND "allowedInstallments" @> '[1]'::jsonb AND "allowedInstallments" <@ '[1,3,6,9]'::jsonb),
 CONSTRAINT "InstallmentCommercialPolicy_amount_check" CHECK("minimumEligibleAmount">=0 AND ("maximumEligibleAmount" IS NULL OR "maximumEligibleAmount">"minimumEligibleAmount")),
 CONSTRAINT "InstallmentCommercialPolicy_window_check" CHECK("effectiveUntil" IS NULL OR "effectiveUntil">"effectiveFrom"),
 CONSTRAINT "InstallmentCommercialPolicy_scope_check" CHECK(
  ("scopeType"='GLOBAL' AND "scopeKey"='GLOBAL' AND "sellerId" IS NULL AND "categoryId" IS NULL AND "sellerOfferId" IS NULL) OR
  ("scopeType"='SELLER' AND "sellerId" IS NOT NULL AND "categoryId" IS NULL AND "sellerOfferId" IS NULL AND "scopeKey"='SELLER:'||"sellerId") OR
  ("scopeType"='CATEGORY' AND "sellerId" IS NULL AND "categoryId" IS NOT NULL AND "sellerOfferId" IS NULL AND "scopeKey"='CATEGORY:'||"categoryId") OR
  ("scopeType"='SELLER_CATEGORY' AND "sellerId" IS NOT NULL AND "categoryId" IS NOT NULL AND "sellerOfferId" IS NULL AND "scopeKey"='SELLER_CATEGORY:'||"sellerId"||':'||"categoryId") OR
  ("scopeType"='SELLER_OFFER' AND "sellerId" IS NOT NULL AND "categoryId" IS NULL AND "sellerOfferId" IS NOT NULL AND "scopeKey"='SELLER_OFFER:'||"sellerOfferId") )
);
CREATE TABLE "InstallmentCommercialPolicyAudit"("id" TEXT NOT NULL,"policyId" TEXT NOT NULL,"actorUserId" TEXT NOT NULL,"actorRole" "UserRole" NOT NULL,"action" VARCHAR(80) NOT NULL,"previousState" JSONB,"newState" JSONB NOT NULL,"expectedVersion" INTEGER,"previousVersion" INTEGER,"newVersion" INTEGER NOT NULL,"reason" VARCHAR(500) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "InstallmentCommercialPolicyAudit_pkey" PRIMARY KEY("id"),CONSTRAINT "InstallmentCommercialPolicyAudit_version_check" CHECK("newVersion">=1 AND ("expectedVersion" IS NULL OR "expectedVersion">=1) AND ("previousVersion" IS NULL OR "previousVersion">=1)));
CREATE INDEX "InstallmentCommercialPolicy_scope_window_idx" ON "InstallmentCommercialPolicy"("scopeKey","effectiveFrom","effectiveUntil");
CREATE INDEX "InstallmentCommercialPolicy_scope_amount_idx" ON "InstallmentCommercialPolicy"("scopeKey","minimumEligibleAmount","maximumEligibleAmount");
CREATE INDEX "InstallmentCommercialPolicyAudit_policyId_newVersion_idx" ON "InstallmentCommercialPolicyAudit"("policyId","newVersion");
CREATE INDEX "InstallmentCommercialPolicyAudit_actorUserId_createdAt_idx" ON "InstallmentCommercialPolicyAudit"("actorUserId","createdAt");
ALTER TABLE "InstallmentCommercialPolicy" ADD CONSTRAINT "InstallmentCommercialPolicy_sellerId_fkey" FOREIGN KEY("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallmentCommercialPolicy" ADD CONSTRAINT "InstallmentCommercialPolicy_categoryId_fkey" FOREIGN KEY("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallmentCommercialPolicy" ADD CONSTRAINT "InstallmentCommercialPolicy_sellerOfferId_fkey" FOREIGN KEY("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallmentCommercialPolicy" ADD CONSTRAINT "InstallmentCommercialPolicy_approvedFromRequestId_fkey" FOREIGN KEY("approvedFromRequestId") REFERENCES "SellerInstallmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallmentCommercialPolicy" ADD CONSTRAINT "InstallmentCommercialPolicy_createdByUserId_fkey" FOREIGN KEY("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallmentCommercialPolicyAudit" ADD CONSTRAINT "InstallmentCommercialPolicyAudit_policyId_fkey" FOREIGN KEY("policyId") REFERENCES "InstallmentCommercialPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallmentCommercialPolicyAudit" ADD CONSTRAINT "InstallmentCommercialPolicyAudit_actorUserId_fkey" FOREIGN KEY("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
