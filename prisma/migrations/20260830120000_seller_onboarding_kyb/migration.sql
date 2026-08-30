CREATE TYPE "SellerOnboardingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_REVISION', 'APPROVED', 'REJECTED');
CREATE TYPE "SellerKybDocumentType" AS ENUM ('TAX_CERTIFICATE', 'TRADE_REGISTRY', 'IDENTITY_DOCUMENT', 'SIGNATURE_CIRCULAR', 'OTHER');
CREATE TYPE "SellerKybDocumentStatus" AS ENUM ('PROVIDED', 'ACCEPTED', 'REJECTED');

ALTER TABLE "SellerProfile"
  ADD COLUMN "onboardingStatus" "SellerOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "legalName" VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN "authorizedPersonName" VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN "authorizedPersonSurname" VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN "authorizedPersonEmail" VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN "authorizedPersonTitle" VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "reviewerUserId" TEXT,
  ADD COLUMN "revisionReason" VARCHAR(500),
  ADD COLUMN "activationEligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "onboardingVersion" INTEGER NOT NULL DEFAULT 0;

-- Preserve existing production seller decisions while new applications start as drafts.
UPDATE "SellerProfile"
SET "onboardingStatus" = CASE
  WHEN "status" = 'APPROVED' THEN 'APPROVED'::"SellerOnboardingStatus"
  WHEN "status" = 'REJECTED' THEN 'REJECTED'::"SellerOnboardingStatus"
  ELSE 'SUBMITTED'::"SellerOnboardingStatus"
END,
"submittedAt" = "createdAt",
"approvedAt" = CASE WHEN "status" = 'APPROVED' THEN "updatedAt" ELSE NULL END,
"reviewedAt" = CASE WHEN "status" IN ('APPROVED', 'REJECTED') THEN "updatedAt" ELSE NULL END,
"activationEligible" = ("status" = 'APPROVED'),
"legalName" = "storeName";

CREATE TABLE "SellerKybDocument" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "type" "SellerKybDocumentType" NOT NULL,
  "reference" VARCHAR(500) NOT NULL,
  "fileName" VARCHAR(191),
  "status" "SellerKybDocumentStatus" NOT NULL DEFAULT 'PROVIDED',
  "reviewNote" VARCHAR(500),
  "providedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerKybDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellerOnboardingEvent" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "fromStatus" "SellerOnboardingStatus",
  "toStatus" "SellerOnboardingStatus" NOT NULL,
  "reason" VARCHAR(500),
  "idempotencyKey" VARCHAR(191) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerOnboardingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerKybDocument_sellerId_type_key" ON "SellerKybDocument"("sellerId", "type");
CREATE INDEX "SellerKybDocument_sellerId_status_idx" ON "SellerKybDocument"("sellerId", "status");
CREATE UNIQUE INDEX "SellerOnboardingEvent_idempotencyKey_key" ON "SellerOnboardingEvent"("idempotencyKey");
CREATE INDEX "SellerOnboardingEvent_sellerId_createdAt_idx" ON "SellerOnboardingEvent"("sellerId", "createdAt");
CREATE INDEX "SellerOnboardingEvent_actorUserId_createdAt_idx" ON "SellerOnboardingEvent"("actorUserId", "createdAt");
CREATE INDEX "SellerProfile_onboardingStatus_createdAt_idx" ON "SellerProfile"("onboardingStatus", "createdAt");
CREATE INDEX "SellerProfile_reviewerUserId_idx" ON "SellerProfile"("reviewerUserId");

ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SellerKybDocument" ADD CONSTRAINT "SellerKybDocument_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SellerOnboardingEvent" ADD CONSTRAINT "SellerOnboardingEvent_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SellerOnboardingEvent" ADD CONSTRAINT "SellerOnboardingEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
