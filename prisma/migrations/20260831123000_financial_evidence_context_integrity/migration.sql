-- Bind every evidence record to the seller that owns its exact tax or bank context.
ALTER TABLE "FinancialVerificationEvidence"
  ADD COLUMN "financialIdentityId" TEXT;

CREATE UNIQUE INDEX "SellerFinancialIdentity_seller_id_key"
  ON "SellerFinancialIdentity"("sellerId", "id");

CREATE UNIQUE INDEX "TaxVerification_seller_id_key"
  ON "TaxVerification"("sellerId", "id");

CREATE INDEX "FinancialEvidence_identity_created_idx"
  ON "FinancialVerificationEvidence"("financialIdentityId", "createdAt");

ALTER TABLE "FinancialVerificationEvidence"
  DROP CONSTRAINT "FinancialVerificationEvidence_exact_context_check",
  DROP CONSTRAINT "FinancialVerificationEvidence_bankRevisionId_fkey",
  DROP CONSTRAINT "FinancialVerificationEvidence_taxVerificationId_fkey";

ALTER TABLE "FinancialVerificationEvidence"
  ADD CONSTRAINT "FinancialVerificationEvidence_exact_context_check"
  CHECK (
    ("taxVerificationId" IS NOT NULL AND "bankDestinationRevisionId" IS NULL AND "financialIdentityId" IS NULL)
    OR
    ("taxVerificationId" IS NULL AND "bankDestinationRevisionId" IS NOT NULL AND "financialIdentityId" IS NOT NULL)
  );

ALTER TABLE "FinancialVerificationEvidence"
  ADD CONSTRAINT "FinancialEvidence_seller_identity_fkey"
  FOREIGN KEY ("sellerId", "financialIdentityId")
  REFERENCES "SellerFinancialIdentity"("sellerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialVerificationEvidence"
  ADD CONSTRAINT "FinancialEvidence_identity_bank_fkey"
  FOREIGN KEY ("financialIdentityId", "bankDestinationRevisionId")
  REFERENCES "BankDestinationRevision"("financialIdentityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialVerificationEvidence"
  ADD CONSTRAINT "FinancialEvidence_seller_tax_fkey"
  FOREIGN KEY ("sellerId", "taxVerificationId")
  REFERENCES "TaxVerification"("sellerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
