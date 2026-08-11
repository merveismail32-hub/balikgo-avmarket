-- AlterTable
-- Nullable by design: existing products remain valid with a NULL SKU.
ALTER TABLE "Product" ADD COLUMN "sku" VARCHAR(80);

-- CreateIndex
-- PostgreSQL permits multiple NULL values while preventing duplicate
-- non-NULL SKUs for the same seller.
CREATE UNIQUE INDEX "Product_sellerId_sku_key" ON "Product"("sellerId", "sku");
