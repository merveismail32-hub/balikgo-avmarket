-- Catalog Intelligence Phase 1 is additive: existing rows remain valid until explicit backfill.
CREATE TYPE "CatalogMatchStatus" AS ENUM ('EXACT_GTIN_MATCH', 'SELLER_SKU_MATCH', 'NEW_CATALOG_PRODUCT', 'REVIEW_REQUIRED', 'CONFLICT');
CREATE TYPE "CatalogMatchReviewStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');

ALTER TABLE "CatalogProduct"
  ADD COLUMN "normalizedGtin" VARCHAR(14),
  ADD COLUMN "normalizedName" VARCHAR(191),
  ADD COLUMN "normalizedBrand" VARCHAR(160),
  ADD COLUMN "normalizedModel" VARCHAR(160);

ALTER TABLE "SellerOffer"
  ADD COLUMN "source" VARCHAR(50),
  ADD COLUMN "externalSourceId" VARCHAR(191),
  ADD COLUMN "matchStatus" "CatalogMatchStatus",
  ADD COLUMN "matchReason" VARCHAR(100),
  ADD COLUMN "matchConfidence" DECIMAL(5,4);

CREATE TABLE "CatalogMatchReview" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "candidateCatalogProductId" TEXT,
  "sellerSku" VARCHAR(80),
  "proposedGtin" VARCHAR(14),
  "normalizedName" VARCHAR(191),
  "normalizedBrand" VARCHAR(160),
  "normalizedModel" VARCHAR(160),
  "matchStatus" "CatalogMatchStatus" NOT NULL,
  "reasonCode" VARCHAR(100) NOT NULL,
  "confidence" DECIMAL(5,4),
  "source" VARCHAR(50),
  "externalSourceId" VARCHAR(191),
  "status" "CatalogMatchReviewStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogMatchReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogProduct_normalizedGtin_key" ON "CatalogProduct"("normalizedGtin");
CREATE INDEX "CatalogProduct_normalizedBrand_normalizedModel_normalizedName_idx" ON "CatalogProduct"("normalizedBrand", "normalizedModel", "normalizedName");
CREATE UNIQUE INDEX "SellerOffer_sellerId_source_externalSourceId_key" ON "SellerOffer"("sellerId", "source", "externalSourceId");
CREATE INDEX "CatalogMatchReview_status_createdAt_idx" ON "CatalogMatchReview"("status", "createdAt");
CREATE INDEX "CatalogMatchReview_sellerId_status_createdAt_idx" ON "CatalogMatchReview"("sellerId", "status", "createdAt");
CREATE INDEX "CatalogMatchReview_candidateCatalogProductId_status_idx" ON "CatalogMatchReview"("candidateCatalogProductId", "status");
ALTER TABLE "CatalogMatchReview" ADD CONSTRAINT "CatalogMatchReview_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogMatchReview" ADD CONSTRAINT "CatalogMatchReview_candidateCatalogProductId_fkey" FOREIGN KEY ("candidateCatalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
