-- Additive marketplace catalog foundation. Legacy Product remains intact.
CREATE TABLE IF NOT EXISTS "CatalogProduct" (
    "id" TEXT NOT NULL, "slug" TEXT NOT NULL, "name" TEXT NOT NULL, "brand" TEXT NOT NULL, "category" TEXT NOT NULL,
    "categoryId" TEXT, "brandId" TEXT, "model" VARCHAR(160), "barcode" VARCHAR(32), "variantKey" VARCHAR(191), "identityKey" VARCHAR(191),
    "description" TEXT NOT NULL, "imageUrl" TEXT NOT NULL, "images" JSONB, "technicalDetails" TEXT NOT NULL DEFAULT '',
    "shippingInfo" TEXT NOT NULL DEFAULT '', "badge" TEXT NOT NULL DEFAULT '', "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT true,
    "moderationStatus" "ProductModerationStatus" NOT NULL DEFAULT 'APPROVED', "moderationReason" VARCHAR(500), "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SellerOffer" (
    "id" TEXT NOT NULL, "sellerId" TEXT NOT NULL, "catalogProductId" TEXT NOT NULL, "legacyProductId" TEXT,
    "sellerSku" VARCHAR(80), "price" DECIMAL(12,2) NOT NULL, "listPrice" DECIMAL(12,2), "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true, "handlingTimeDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellerOffer_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "catalogProductId" TEXT;
ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "catalogProductId" TEXT;
ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "sellerOfferId" TEXT;
ALTER TABLE "Favorite" ADD COLUMN IF NOT EXISTS "catalogProductId" TEXT;
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "catalogProductId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "catalogProductId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "sellerOfferId" TEXT;

-- Conservative backfill: one catalog identity per legacy Product. No name-based merging.
INSERT INTO "CatalogProduct" ("id", "slug", "name", "brand", "category", "categoryId", "brandId", "identityKey", "description", "imageUrl", "images", "technicalDetails", "shippingInfo", "badge", "rating", "reviewCount", "active", "moderationStatus", "moderationReason", "moderatedAt", "createdAt", "updatedAt")
SELECT 'cat_' || p."id", p."slug", p."name", p."brand", p."category", p."categoryId", p."brandId", 'legacy:' || p."id", p."description", p."imageUrl", p."images", p."technicalDetails", p."shippingInfo", p."badge", p."rating", p."reviewCount", p."active", p."moderationStatus", p."moderationReason", p."moderatedAt", p."createdAt", p."updatedAt"
FROM "Product" p;

UPDATE "Product" p SET "catalogProductId" = c."id" FROM "CatalogProduct" c
WHERE c."identityKey" = 'legacy:' || p."id" AND p."catalogProductId" IS NULL;

INSERT INTO "SellerOffer" ("id", "sellerId", "catalogProductId", "legacyProductId", "sellerSku", "price", "listPrice", "stock", "active", "createdAt", "updatedAt")
SELECT 'off_' || p."id", p."sellerId", p."catalogProductId", p."id", p."sku", p."price", p."oldPrice", p."stock", p."active", p."createdAt", p."updatedAt"
FROM "Product" p WHERE p."catalogProductId" IS NOT NULL;

UPDATE "CartItem" ci SET "catalogProductId" = p."catalogProductId", "sellerOfferId" = o."id"
FROM "Product" p JOIN "SellerOffer" o ON o."legacyProductId" = p."id" WHERE ci."productId" = p."id";
UPDATE "Favorite" f SET "catalogProductId" = p."catalogProductId" FROM "Product" p WHERE f."productId" = p."id";
UPDATE "Review" r SET "catalogProductId" = p."catalogProductId" FROM "Product" p WHERE r."productId" = p."id";
UPDATE "OrderItem" oi SET "catalogProductId" = p."catalogProductId", "sellerOfferId" = o."id"
FROM "Product" p JOIN "SellerOffer" o ON o."legacyProductId" = p."id" WHERE oi."productId" = p."id";

CREATE UNIQUE INDEX "CatalogProduct_slug_key" ON "CatalogProduct"("slug");
CREATE UNIQUE INDEX "CatalogProduct_barcode_key" ON "CatalogProduct"("barcode");
CREATE UNIQUE INDEX "CatalogProduct_identityKey_key" ON "CatalogProduct"("identityKey");
CREATE INDEX "CatalogProduct_moderationStatus_active_createdAt_idx" ON "CatalogProduct"("moderationStatus", "active", "createdAt");
CREATE INDEX "CatalogProduct_categoryId_idx" ON "CatalogProduct"("categoryId");
CREATE INDEX "CatalogProduct_brandId_idx" ON "CatalogProduct"("brandId");
CREATE INDEX "CatalogProduct_brand_model_variantKey_idx" ON "CatalogProduct"("brand", "model", "variantKey");
CREATE UNIQUE INDEX "SellerOffer_legacyProductId_key" ON "SellerOffer"("legacyProductId");
CREATE UNIQUE INDEX "SellerOffer_sellerId_catalogProductId_key" ON "SellerOffer"("sellerId", "catalogProductId");
CREATE UNIQUE INDEX "SellerOffer_sellerId_sellerSku_key" ON "SellerOffer"("sellerId", "sellerSku");
CREATE INDEX "SellerOffer_catalogProductId_active_stock_idx" ON "SellerOffer"("catalogProductId", "active", "stock");
CREATE INDEX "SellerOffer_sellerId_active_updatedAt_idx" ON "SellerOffer"("sellerId", "active", "updatedAt");
CREATE INDEX "Product_catalogProductId_idx" ON "Product"("catalogProductId");
CREATE INDEX "CartItem_catalogProductId_idx" ON "CartItem"("catalogProductId");
CREATE INDEX "CartItem_sellerOfferId_idx" ON "CartItem"("sellerOfferId");
CREATE UNIQUE INDEX "Favorite_userId_catalogProductId_key" ON "Favorite"("userId", "catalogProductId");
CREATE INDEX "Favorite_catalogProductId_idx" ON "Favorite"("catalogProductId");
CREATE UNIQUE INDEX "Review_userId_catalogProductId_key" ON "Review"("userId", "catalogProductId");
CREATE INDEX "Review_catalogProductId_status_createdAt_idx" ON "Review"("catalogProductId", "status", "createdAt");
CREATE INDEX "OrderItem_catalogProductId_idx" ON "OrderItem"("catalogProductId");
CREATE INDEX "OrderItem_sellerOfferId_idx" ON "OrderItem"("sellerOfferId");

ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SellerOffer" ADD CONSTRAINT "SellerOffer_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerOffer" ADD CONSTRAINT "SellerOffer_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerOffer" ADD CONSTRAINT "SellerOffer_legacyProductId_fkey" FOREIGN KEY ("legacyProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
