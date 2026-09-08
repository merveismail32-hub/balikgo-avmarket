ALTER TABLE "SellerOffer"
ADD COLUMN "priceVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SellerOffer"
ADD CONSTRAINT "SellerOffer_priceVersion_check" CHECK ("priceVersion" >= 1),
ADD CONSTRAINT "SellerOffer_seller_id_key" UNIQUE ("sellerId", "id");

CREATE TABLE "SellerOfferPriceObservation" (
    "id" TEXT NOT NULL,
    "sellerOfferId" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "previousAmount" DECIMAL(12,2),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TRY',
    "priceVersion" INTEGER NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "actorUserId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SellerOfferPriceObservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SellerOfferPriceObservation_amount_check" CHECK ("amount" > 0 AND "previousAmount" IS DISTINCT FROM "amount"),
    CONSTRAINT "SellerOfferPriceObservation_priceVersion_check" CHECK ("priceVersion" >= 1),
    CONSTRAINT "SellerOfferPriceObservation_currency_check" CHECK ("currency" = 'TRY'),
    CONSTRAINT "SellerOfferPriceObservation_offer_fkey" FOREIGN KEY ("sellerId", "sellerOfferId") REFERENCES "SellerOffer"("sellerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SellerOfferPriceObservation_catalog_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SellerOfferPriceObservation_seller_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SellerOfferPriceObservation_actor_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SellerOfferPriceObservation_offer_version_key" ON "SellerOfferPriceObservation"("sellerOfferId", "priceVersion");
CREATE INDEX "SellerOfferPriceObservation_catalog_observed_idx" ON "SellerOfferPriceObservation"("catalogProductId", "observedAt");
CREATE INDEX "SellerOfferPriceObservation_seller_observed_idx" ON "SellerOfferPriceObservation"("sellerId", "observedAt");
