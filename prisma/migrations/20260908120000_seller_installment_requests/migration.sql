CREATE TYPE "SellerInstallmentRequestStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "SellerInstallmentRequestScope" AS ENUM ('SELLER', 'SELLER_OFFER');

CREATE TABLE "SellerInstallmentRequest" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "scopeType" "SellerInstallmentRequestScope" NOT NULL,
  "sellerOfferId" TEXT,
  "activeScopeKey" VARCHAR(191),
  "requestedAllowedInstallments" JSONB NOT NULL,
  "status" "SellerInstallmentRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
  "sellerReason" VARCHAR(500) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "approvedAllowedInstallments" JSONB,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionReason" VARCHAR(500),
  "approvedControlId" TEXT,
  "approvedControlVersion" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerInstallmentRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SellerInstallmentRequest_version_check" CHECK ("version" >= 1),
  CONSTRAINT "SellerInstallmentRequest_requested_set_check" CHECK (jsonb_typeof("requestedAllowedInstallments") = 'array' AND "requestedAllowedInstallments" @> '[1]'::jsonb AND "requestedAllowedInstallments" <@ '[1, 3, 6, 9]'::jsonb),
  CONSTRAINT "SellerInstallmentRequest_approved_set_check" CHECK ("approvedAllowedInstallments" IS NULL OR (jsonb_typeof("approvedAllowedInstallments") = 'array' AND "approvedAllowedInstallments" @> '[1]'::jsonb AND "approvedAllowedInstallments" <@ "requestedAllowedInstallments")),
  CONSTRAINT "SellerInstallmentRequest_scope_check" CHECK (("scopeType" = 'SELLER' AND "sellerOfferId" IS NULL) OR ("scopeType" = 'SELLER_OFFER' AND "sellerOfferId" IS NOT NULL)),
  CONSTRAINT "SellerInstallmentRequest_lifecycle_check" CHECK (
    ("status" = 'SUBMITTED' AND "activeScopeKey" IS NOT NULL AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL AND "decisionReason" IS NULL AND "approvedAllowedInstallments" IS NULL AND "approvedControlId" IS NULL AND "approvedControlVersion" IS NULL)
    OR ("status" = 'CANCELLED' AND "activeScopeKey" IS NULL AND "decidedByUserId" IS NULL AND "decidedAt" IS NOT NULL AND "decisionReason" IS NOT NULL AND "approvedAllowedInstallments" IS NULL AND "approvedControlId" IS NULL AND "approvedControlVersion" IS NULL)
    OR ("status" = 'REJECTED' AND "activeScopeKey" IS NULL AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decisionReason" IS NOT NULL AND "approvedAllowedInstallments" IS NULL AND "approvedControlId" IS NULL AND "approvedControlVersion" IS NULL)
    OR ("status" = 'APPROVED' AND "activeScopeKey" IS NULL AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decisionReason" IS NOT NULL AND "approvedAllowedInstallments" IS NOT NULL AND (("scopeType" = 'SELLER' AND "approvedControlId" IS NOT NULL AND "approvedControlVersion" >= 1) OR ("scopeType" = 'SELLER_OFFER' AND "approvedControlId" IS NULL AND "approvedControlVersion" IS NULL)))
  )
);

CREATE TABLE "SellerInstallmentRequestAudit" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "sellerId" TEXT NOT NULL, "actorUserId" TEXT NOT NULL, "actorRole" "UserRole" NOT NULL,
  "action" VARCHAR(80) NOT NULL, "previousStatus" "SellerInstallmentRequestStatus", "newStatus" "SellerInstallmentRequestStatus" NOT NULL,
  "requestedSet" JSONB NOT NULL, "approvedSet" JSONB, "expectedVersion" INTEGER, "previousVersion" INTEGER, "newVersion" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerInstallmentRequestAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SellerInstallmentRequestAudit_versions_check" CHECK ("newVersion" >= 1 AND ("expectedVersion" IS NULL OR "expectedVersion" >= 1) AND ("previousVersion" IS NULL OR "previousVersion" >= 1))
);

CREATE UNIQUE INDEX "SellerInstallmentRequest_active_scope_key" ON "SellerInstallmentRequest"("activeScopeKey");
CREATE INDEX "SellerInstallmentRequest_seller_status_idx" ON "SellerInstallmentRequest"("sellerId", "status", "createdAt");
CREATE INDEX "SellerInstallmentRequest_offer_status_idx" ON "SellerInstallmentRequest"("sellerOfferId", "status", "createdAt");
CREATE INDEX "SellerInstallmentRequestAudit_request_version_idx" ON "SellerInstallmentRequestAudit"("requestId", "newVersion");
CREATE INDEX "SellerInstallmentRequestAudit_seller_created_idx" ON "SellerInstallmentRequestAudit"("sellerId", "createdAt");

ALTER TABLE "SellerInstallmentRequest" ADD CONSTRAINT "SellerInstallmentRequest_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerInstallmentRequest" ADD CONSTRAINT "SellerInstallmentRequest_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerInstallmentRequest" ADD CONSTRAINT "SellerInstallmentRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerInstallmentRequest" ADD CONSTRAINT "SellerInstallmentRequest_approvedControlId_fkey" FOREIGN KEY ("approvedControlId") REFERENCES "SellerInstallmentControl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerInstallmentRequestAudit" ADD CONSTRAINT "SellerInstallmentRequestAudit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SellerInstallmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerInstallmentRequestAudit" ADD CONSTRAINT "SellerInstallmentRequestAudit_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerInstallmentRequestAudit" ADD CONSTRAINT "SellerInstallmentRequestAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
