-- AlterTable
ALTER TABLE "SellerProfile" ADD COLUMN "storeSlug" TEXT;
ALTER TABLE "SellerProfile" ADD COLUMN "phone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SellerProfile" ADD COLUMN "categories" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "technicalDetails" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "shippingInfo" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "SellerProfile_storeSlug_key" ON "SellerProfile"("storeSlug");
