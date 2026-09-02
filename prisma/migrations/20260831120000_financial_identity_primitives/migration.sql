-- #20 Slice A is additive and fail-closed: it creates no identity rows and grants no verification.
CREATE TYPE "FinancialVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'NEEDS_REVIEW', 'VERIFIED', 'REJECTED', 'REVERIFICATION_REQUIRED');
CREATE TYPE "FinancialVerificationSource" AS ENUM ('LOCAL', 'MANUAL', 'PROVIDER', 'AUTHORITY');
CREATE TYPE "FinancialVerificationAssurance" AS ENUM ('LOCAL_CHECKS_ONLY', 'DOCUMENT_REVIEWED', 'PROVIDER_VERIFIED', 'AUTHORITY_VERIFIED');
CREATE TYPE "TaxIdentifierType" AS ENUM ('TCKN', 'VKN');

ALTER TABLE "User"
  ADD COLUMN "financialIdentityReviewerEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SellerFinancialIdentity" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "currentBankDestinationRevisionId" TEXT,
  "coordinationVersion" INTEGER NOT NULL DEFAULT 0,
  "holdActive" BOOLEAN NOT NULL DEFAULT true,
  "holdReasonCode" VARCHAR(100) NOT NULL DEFAULT 'FINANCIAL_IDENTITY_INCOMPLETE',
  "holdSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "holdReleasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerFinancialIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankDestinationRevision" (
  "id" TEXT NOT NULL,
  "financialIdentityId" TEXT NOT NULL,
  "destinationVersion" INTEGER NOT NULL,
  "canonicalIban" VARCHAR(34) NOT NULL,
  "beneficiaryName" VARCHAR(191) NOT NULL,
  "normalizedFingerprint" VARCHAR(64) NOT NULL,
  "verificationStatus" "FinancialVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "verificationSource" "FinancialVerificationSource" NOT NULL DEFAULT 'LOCAL',
  "verificationAssurance" "FinancialVerificationAssurance" NOT NULL DEFAULT 'LOCAL_CHECKS_ONLY',
  "submittedAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankDestinationRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxVerification" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "onboardingVersion" INTEGER NOT NULL,
  "identifierType" "TaxIdentifierType" NOT NULL,
  "normalizedFingerprint" VARCHAR(64) NOT NULL,
  "verificationStatus" "FinancialVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "verificationSource" "FinancialVerificationSource" NOT NULL DEFAULT 'LOCAL',
  "verificationAssurance" "FinancialVerificationAssurance" NOT NULL DEFAULT 'LOCAL_CHECKS_ONLY',
  "reviewerUserId" TEXT,
  "reasonCode" VARCHAR(100),
  "idempotencyKey" VARCHAR(191) NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialVerificationEvidence" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "bankDestinationRevisionId" TEXT,
  "taxVerificationId" TEXT,
  "verificationSource" "FinancialVerificationSource" NOT NULL,
  "verificationAssurance" "FinancialVerificationAssurance" NOT NULL,
  "normalizedFingerprint" VARCHAR(64) NOT NULL,
  "identityVersion" INTEGER NOT NULL,
  "reviewerUserId" TEXT,
  "evidenceReference" VARCHAR(500),
  "reasonCode" VARCHAR(100),
  "requestIdempotencyKey" VARCHAR(191) NOT NULL,
  "providerName" VARCHAR(80),
  "providerEnvironment" VARCHAR(40),
  "providerAccountReference" VARCHAR(191),
  "providerReference" VARCHAR(191),
  "providerEventId" VARCHAR(191),
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialVerificationEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialVerificationEvidence_exact_context_check"
    CHECK (num_nonnulls("bankDestinationRevisionId", "taxVerificationId") = 1)
);

CREATE UNIQUE INDEX "SellerFinancialIdentity_seller_key" ON "SellerFinancialIdentity"("sellerId");
CREATE UNIQUE INDEX "SellerFinancialIdentity_current_bank_key" ON "SellerFinancialIdentity"("currentBankDestinationRevisionId");
CREATE UNIQUE INDEX "SellerFinancialIdentity_current_pair_key" ON "SellerFinancialIdentity"("id", "currentBankDestinationRevisionId");
CREATE INDEX "SellerFinancialIdentity_hold_updated_idx" ON "SellerFinancialIdentity"("holdActive", "updatedAt");

CREATE UNIQUE INDEX "BankDestinationRevision_identity_version_key" ON "BankDestinationRevision"("financialIdentityId", "destinationVersion");
CREATE UNIQUE INDEX "BankDestinationRevision_identity_id_key" ON "BankDestinationRevision"("financialIdentityId", "id");
CREATE INDEX "BankDestinationRevision_identity_fingerprint_idx" ON "BankDestinationRevision"("financialIdentityId", "normalizedFingerprint");
CREATE INDEX "BankDestinationRevision_status_created_idx" ON "BankDestinationRevision"("verificationStatus", "createdAt");

CREATE UNIQUE INDEX "TaxVerification_idempotencyKey_key" ON "TaxVerification"("idempotencyKey");
CREATE UNIQUE INDEX "TaxVerification_seller_version_fingerprint_key" ON "TaxVerification"("sellerId", "onboardingVersion", "normalizedFingerprint");
CREATE INDEX "TaxVerification_seller_status_created_idx" ON "TaxVerification"("sellerId", "verificationStatus", "createdAt");
CREATE INDEX "TaxVerification_reviewer_created_idx" ON "TaxVerification"("reviewerUserId", "createdAt");

CREATE UNIQUE INDEX "FinancialVerificationEvidence_requestIdempotencyKey_key" ON "FinancialVerificationEvidence"("requestIdempotencyKey");
CREATE UNIQUE INDEX "FinancialEvidence_provider_event_key" ON "FinancialVerificationEvidence"("providerName", "providerEnvironment", "providerAccountReference", "providerEventId");
CREATE INDEX "FinancialEvidence_seller_created_idx" ON "FinancialVerificationEvidence"("sellerId", "createdAt");
CREATE INDEX "FinancialEvidence_bank_created_idx" ON "FinancialVerificationEvidence"("bankDestinationRevisionId", "createdAt");
CREATE INDEX "FinancialEvidence_tax_created_idx" ON "FinancialVerificationEvidence"("taxVerificationId", "createdAt");
CREATE INDEX "FinancialEvidence_reviewer_created_idx" ON "FinancialVerificationEvidence"("reviewerUserId", "createdAt");

ALTER TABLE "SellerFinancialIdentity"
  ADD CONSTRAINT "SellerFinancialIdentity_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankDestinationRevision"
  ADD CONSTRAINT "BankDestinationRevision_financialIdentityId_fkey"
  FOREIGN KEY ("financialIdentityId") REFERENCES "SellerFinancialIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SellerFinancialIdentity"
  ADD CONSTRAINT "SellerFinancialIdentity_current_bank_fkey"
  FOREIGN KEY ("id", "currentBankDestinationRevisionId")
  REFERENCES "BankDestinationRevision"("financialIdentityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaxVerification"
  ADD CONSTRAINT "TaxVerification_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaxVerification"
  ADD CONSTRAINT "TaxVerification_reviewerUserId_fkey"
  FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialVerificationEvidence"
  ADD CONSTRAINT "FinancialVerificationEvidence_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialVerificationEvidence"
  ADD CONSTRAINT "FinancialVerificationEvidence_bankRevisionId_fkey"
  FOREIGN KEY ("bankDestinationRevisionId") REFERENCES "BankDestinationRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialVerificationEvidence"
  ADD CONSTRAINT "FinancialVerificationEvidence_taxVerificationId_fkey"
  FOREIGN KEY ("taxVerificationId") REFERENCES "TaxVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialVerificationEvidence"
  ADD CONSTRAINT "FinancialVerificationEvidence_reviewerUserId_fkey"
  FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
