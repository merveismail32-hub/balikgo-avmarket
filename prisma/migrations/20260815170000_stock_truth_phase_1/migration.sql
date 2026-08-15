-- Additive Stock Truth Engine Phase 1 foundation.
CREATE TYPE "StockMovementType" AS ENUM ('CHECKOUT_DECREMENT', 'CANCELLATION_RESTORE', 'SELLER_ABSOLUTE_SET');

ALTER TABLE "SellerOffer" ADD COLUMN "inventoryVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "sellerOfferId" TEXT NOT NULL,
    "productId" TEXT,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "paymentId" TEXT,
    "refundId" TEXT,
    "actorUserId" TEXT,
    "actorSellerId" TEXT,
    "type" "StockMovementType" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "inventoryVersionBefore" INTEGER NOT NULL,
    "inventoryVersionAfter" INTEGER NOT NULL,
    "idempotencyKey" VARCHAR(191) NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StockMovement_stockBefore_nonnegative" CHECK ("stockBefore" >= 0),
    CONSTRAINT "StockMovement_stockAfter_nonnegative" CHECK ("stockAfter" >= 0),
    CONSTRAINT "StockMovement_delta_consistent" CHECK ("stockAfter" = "stockBefore" + "quantityDelta"),
    CONSTRAINT "StockMovement_version_consistent" CHECK ("inventoryVersionAfter" = "inventoryVersionBefore" + 1)
);

ALTER TABLE "SellerOffer" ADD CONSTRAINT "SellerOffer_stock_nonnegative" CHECK ("stock" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_nonnegative" CHECK ("stock" >= 0);
CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key" ON "StockMovement"("idempotencyKey");
CREATE INDEX "StockMovement_sellerOfferId_createdAt_idx" ON "StockMovement"("sellerOfferId", "createdAt");
CREATE INDEX "StockMovement_orderItemId_createdAt_idx" ON "StockMovement"("orderItemId", "createdAt");
CREATE INDEX "StockMovement_orderId_createdAt_idx" ON "StockMovement"("orderId", "createdAt");
CREATE INDEX "StockMovement_paymentId_createdAt_idx" ON "StockMovement"("paymentId", "createdAt");
CREATE INDEX "StockMovement_refundId_createdAt_idx" ON "StockMovement"("refundId", "createdAt");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
