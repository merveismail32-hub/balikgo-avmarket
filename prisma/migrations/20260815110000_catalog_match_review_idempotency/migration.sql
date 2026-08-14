-- Additive open-review idempotency. Existing review rows remain untouched.
ALTER TABLE "CatalogMatchReview"
  ADD COLUMN "sellerOfferId" TEXT,
  ADD COLUMN "fingerprint" CHAR(64),
  ADD COLUMN "openFingerprint" CHAR(64);

CREATE UNIQUE INDEX "CatalogMatchReview_openFingerprint_key" ON "CatalogMatchReview"("openFingerprint");
CREATE INDEX "CatalogMatchReview_sellerOfferId_status_createdAt_idx" ON "CatalogMatchReview"("sellerOfferId", "status", "createdAt");

ALTER TABLE "CatalogMatchReview"
  ADD CONSTRAINT "CatalogMatchReview_sellerOfferId_fkey"
  FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
