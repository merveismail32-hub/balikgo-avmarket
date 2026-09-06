import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(root, "prisma/migrations/20260905130000_order_item_commission_policy_provenance/migration.sql"), "utf8");
const checkout = readFileSync(resolve(root, "app/api/orders/route.ts"), "utf8");
const helper = readFileSync(resolve(root, "app/lib/checkout-commission-policy.ts"), "utf8");
const customerSelect = readFileSync(resolve(root, "app/lib/customer-order-select.ts"), "utf8");

assert.match(schema, /commissionPolicySource\s+String\?[\s\S]*commissionPolicyReference\s+String\?[\s\S]*commissionAgreementId\s+String\?[\s\S]*commissionAgreementVersion\s+Int\?/);
assert.doesNotMatch(schema, /commissionAgreement\s+SellerCategoryCommissionAgreement/, "historical evidence must not have a live agreement relation");
assert.match(migration, /ADD COLUMN "commissionPolicySource" VARCHAR\(40\),[\s\S]*ADD COLUMN "commissionAgreementVersion" INTEGER/);
assert.doesNotMatch(migration, /UPDATE "OrderItem"|SET "commissionPolicySource"|FOREIGN KEY/, "migration must not backfill or create a live FK");
assert.match(migration, /"commissionPolicySource" IS NULL[\s\S]*"commissionAgreementId" IS NULL[\s\S]*"commissionPolicySource" = 'SELLER_CATEGORY_AGREEMENT'[\s\S]*"commissionAgreementId" IS NOT NULL[\s\S]*"commissionAgreementVersion" >= 1[\s\S]*'GLOBAL_CONFIG', 'DEFAULT_FALLBACK'/);
assert.match(checkout, /const \{ money, provenance \} = await commissionForCheckoutLine[\s\S]*commissionRate: money\.rate[\s\S]*\.\.\.provenance/);
assert.equal((helper.match(/resolveCommissionPolicy\(/g) ?? []).length, 1, "rate and provenance must share one resolver decision");
for (const field of ["commissionPolicySource", "commissionPolicyReference", "commissionAgreementId", "commissionAgreementVersion"]) {
  assert.doesNotMatch(customerSelect, new RegExp(`\\b${field}\\b`), `${field} leaked into customer select`);
}

console.log("PASS: #22 Slice E nullable immutable provenance schema, source consistency, single-decision checkout and customer-safe boundary");
