ALTER TABLE "SellerOffer" ADD COLUMN "priceAnomalyHeld" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SellerOfferPriceAnomalyHold" (
  "id" TEXT NOT NULL,
  "sellerOfferId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "triggerPriceVersion" INTEGER NOT NULL,
  "anomalyStatus" VARCHAR(30) NOT NULL,
  "anomalyConfidence" VARCHAR(20) NOT NULL,
  "reasonCodes" JSONB NOT NULL,
  "algorithmVersion" VARCHAR(80) NOT NULL,
  "benchmarkSnapshot" JSONB NOT NULL,
  "evaluatedAt" TIMESTAMP(3) NOT NULL,
  "enforcementPolicyVersion" VARCHAR(80) NOT NULL,
  "activeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerOfferPriceAnomalyHold_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SellerOfferPriceAnomalyRelease" (
  "id" TEXT NOT NULL,
  "holdId" TEXT NOT NULL,
  "sellerOfferId" TEXT NOT NULL,
  "releasePriceVersion" INTEGER NOT NULL,
  "anomalyStatus" VARCHAR(30) NOT NULL,
  "anomalyConfidence" VARCHAR(20) NOT NULL,
  "reasonCodes" JSONB NOT NULL,
  "algorithmVersion" VARCHAR(80) NOT NULL,
  "benchmarkSnapshot" JSONB NOT NULL,
  "evaluatedAt" TIMESTAMP(3) NOT NULL,
  "enforcementPolicyVersion" VARCHAR(80) NOT NULL,
  "source" VARCHAR(80) NOT NULL DEFAULT 'PRICE_ANOMALY_REVALIDATION',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerOfferPriceAnomalyRelease_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SellerOfferPriceAnomalyHold_activeKey_key" ON "SellerOfferPriceAnomalyHold"("activeKey");
CREATE UNIQUE INDEX "SellerOfferPriceAnomalyHold_offer_version_key" ON "SellerOfferPriceAnomalyHold"("sellerOfferId", "triggerPriceVersion");
CREATE INDEX "SellerOfferPriceAnomalyHold_sellerId_createdAt_idx" ON "SellerOfferPriceAnomalyHold"("sellerId", "createdAt");
CREATE UNIQUE INDEX "SellerOfferPriceAnomalyRelease_holdId_key" ON "SellerOfferPriceAnomalyRelease"("holdId");
CREATE INDEX "SellerOfferPriceAnomalyRelease_sellerOfferId_createdAt_idx" ON "SellerOfferPriceAnomalyRelease"("sellerOfferId", "createdAt");
ALTER TABLE "SellerOfferPriceAnomalyHold" ADD CONSTRAINT "SellerOfferPriceAnomalyHold_sellerId_sellerOfferId_fkey" FOREIGN KEY ("sellerId", "sellerOfferId") REFERENCES "SellerOffer"("sellerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerOfferPriceAnomalyRelease" ADD CONSTRAINT "SellerOfferPriceAnomalyRelease_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "SellerOfferPriceAnomalyHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
