CREATE TABLE "SellerCategoryCommissionAgreement" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "commissionRate" DECIMAL(5,4) NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerCategoryCommissionAgreement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SellerCategoryCommissionAgreement_rate_check" CHECK ("commissionRate" >= 0 AND "commissionRate" <= 1),
  CONSTRAINT "SellerCategoryCommissionAgreement_window_check" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom"),
  CONSTRAINT "SellerCategoryCommissionAgreement_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "SellerCategoryCommissionAgreement_scope_start_key"
  ON "SellerCategoryCommissionAgreement"("sellerId", "categoryId", "effectiveFrom");
CREATE INDEX "SellerCategoryCommissionAgreement_scope_window_idx"
  ON "SellerCategoryCommissionAgreement"("sellerId", "categoryId", "effectiveFrom", "effectiveUntil");

ALTER TABLE "SellerCategoryCommissionAgreement"
  ADD CONSTRAINT "SellerCategoryCommissionAgreement_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerCategoryCommissionAgreement"
  ADD CONSTRAINT "SellerCategoryCommissionAgreement_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
