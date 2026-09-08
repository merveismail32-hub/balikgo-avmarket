import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(root, "prisma/migrations/20260912120000_seller_offer_price_observations/migration.sql"), "utf8");
const service = readFileSync(resolve(root, "app/lib/seller-offer-price.ts"), "utf8");
const productRoute = readFileSync(resolve(root, "app/api/seller/products/[id]/route.ts"), "utf8");
const inventoryRoute = readFileSync(resolve(root, "app/api/seller/products/[id]/inventory/route.ts"), "utf8");
const checkout = readFileSync(resolve(root, "app/api/orders/route.ts"), "utf8");

assert.match(schema, /priceVersion\s+Int\s+@default\(1\)/);
assert.match(schema, /model SellerOfferPriceObservation[\s\S]*previousAmount\s+Decimal\?[\s\S]*amount\s+Decimal[\s\S]*currency\s+String\s+@default\("TRY"\)[\s\S]*@@unique\(\[sellerOfferId, priceVersion\]/);
assert.doesNotMatch(migration, /(?:^|\n)\s*(?:UPDATE|DELETE FROM|INSERT INTO|DROP|TRUNCATE)\b/i, "migration must not invent historical business rows");
assert.match(migration, /FOREIGN KEY \("sellerId", "sellerOfferId"\)/);
assert.match(service, /current\.price\.equals\(price\)[\s\S]*changed: false/);
assert.match(service, /priceVersion: input\.expectedPriceVersion[\s\S]*increment: 1/);
assert.match(service, /sellerOffer\.updateMany[\s\S]*sellerOfferPriceObservation\.create/);
assert.match(productRoute, /expectedPriceVersion/);
assert.match(inventoryRoute, /expectedPriceVersion/);
assert.doesNotMatch(service, /inventoryVersion/);
assert.match(checkout, /product\.sellerOffer\.price\.mul/);
assert.doesNotMatch(checkout, /sellerOfferPriceObservation/);
console.log("PASS: #25 Slice B additive price version, immutable evidence contract, no-op/CAS and checkout authority isolation");
