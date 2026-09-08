CREATE TABLE "AdminPriceIntervention" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorRole" VARCHAR(20) NOT NULL,
  "sellerOfferId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "catalogProductId" TEXT NOT NULL,
  "previousPrice" DECIMAL(12,2) NOT NULL,
  "newPrice" DECIMAL(12,2) NOT NULL,
  "previousPriceVersion" INTEGER NOT NULL,
  "newPriceVersion" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "previousHoldState" BOOLEAN NOT NULL,
  "resultingHoldState" BOOLEAN NOT NULL,
  "anomalyBefore" JSONB,
  "anomalyAfter" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminPriceIntervention_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminPriceIntervention_sellerOfferId_createdAt_idx" ON "AdminPriceIntervention"("sellerOfferId", "createdAt");
CREATE INDEX "AdminPriceIntervention_actorUserId_createdAt_idx" ON "AdminPriceIntervention"("actorUserId", "createdAt");
CREATE INDEX "AdminPriceIntervention_sellerId_createdAt_idx" ON "AdminPriceIntervention"("sellerId", "createdAt");
ALTER TABLE "AdminPriceIntervention" ADD CONSTRAINT "AdminPriceIntervention_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminPriceIntervention" ADD CONSTRAINT "AdminPriceIntervention_sellerId_sellerOfferId_fkey" FOREIGN KEY ("sellerId", "sellerOfferId") REFERENCES "SellerOffer"("sellerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
