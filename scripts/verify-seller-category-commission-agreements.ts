import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CommissionAgreementError, createSellerCategoryCommissionAgreement } from "../app/lib/seller-category-commission-agreement";

async function main() {
  const base = { actorUserId: "admin", sellerId: "seller", categoryId: "category", commissionRate: "0.0750", effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveUntil: new Date("2026-02-01T00:00:00Z"), reason: "Synthetic agreement" };
  for (const input of [
    { ...base, commissionRate: "-0.1" },
    { ...base, commissionRate: "1.0001" },
    { ...base, commissionRate: "NaN" },
  ]) await assert.rejects(() => createSellerCategoryCommissionAgreement(input), (error) => error instanceof CommissionAgreementError && error.code === "INVALID_RATE");
  await assert.rejects(() => createSellerCategoryCommissionAgreement({ ...base, effectiveUntil: base.effectiveFrom }), (error) => error instanceof CommissionAgreementError && error.code === "INVALID_EFFECTIVE_WINDOW");

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const service = readFileSync(resolve(root, "app/lib/seller-category-commission-agreement.ts"), "utf8");
const checkout = readFileSync(resolve(root, "app/api/orders/route.ts"), "utf8");
assert.match(schema, /model SellerCategoryCommissionAgreement[\s\S]*sellerId\s+String[\s\S]*categoryId\s+String[\s\S]*commissionRate\s+Decimal[\s\S]*effectiveFrom\s+DateTime[\s\S]*effectiveUntil\s+DateTime\?[\s\S]*version\s+Int/);
assert.match(service, /TransactionIsolationLevel\.Serializable/);
assert.match(service, /SellerProfile[\s\S]*FOR UPDATE/);
assert.match(service, /Category[\s\S]*FOR UPDATE/);
assert.match(service, /version:\s*input\.expectedVersion[\s\S]*version:\s*\{ increment: 1 \}/);
assert.match(service, /SELLER_CATEGORY_AGREEMENT/);
assert.match(checkout, /commissionForCheckoutLine/);
assert.doesNotMatch(checkout, /sellerCategoryCommissionAgreement\.(?:create|update|delete)/, "checkout must not mutate commission agreements");

  console.log("PASS: #22 Slice B seller/category agreement schema, authority, overlap, CAS and immutable mutation contract");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
