import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CommissionPolicySelectionError } from "../app/lib/commission-policy";

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const policy = readFileSync(resolve(root, "app/lib/commission-policy.ts"), "utf8");
  const checkout = readFileSync(resolve(root, "app/api/orders/route.ts"), "utf8");

  assert.match(policy, /getEffectiveSellerCategoryCommissionAgreement/);
  assert.match(policy, /AMBIGUOUS_COMMISSION_POLICY/);
  assert.match(policy, /selectCommissionPolicyFromServerConfig\(configuredRate\)/);
  assert.doesNotMatch(policy, /calculateCommission|gross|sellerNet|commissionAmount/);
  assert.doesNotMatch(checkout, /resolveCommissionPolicy|sellerCategoryCommissionAgreement/);

  const { resolveCommissionPolicy } = await import("../app/lib/commission-policy");
  const fakeClient = { sellerCategoryCommissionAgreement: { findMany: async () => [] } };
  const global = await resolveCommissionPolicy(
    { sellerId: "seller-a", categoryId: "category-a", effectiveAt: new Date("2026-01-01T00:00:00.000Z") },
    { configuredRate: "0.1250", client: fakeClient as never },
  );
  assert.equal(global.source, "GLOBAL_CONFIG");
  assert.equal(global.rate.toString(), "0.125");

  const fallback = await resolveCommissionPolicy(
    { sellerId: "seller-a", categoryId: "category-a", effectiveAt: new Date("2026-01-01T00:00:00.000Z") },
    { configuredRate: undefined, client: fakeClient as never },
  );
  assert.equal(fallback.source, "DEFAULT_FALLBACK");
  assert.equal(fallback.rate.toString(), "0.1");
  await assert.rejects(
    () => resolveCommissionPolicy(
      { sellerId: "seller-a", categoryId: "category-a", effectiveAt: new Date("2026-01-01T00:00:00.000Z") },
      { configuredRate: "invalid", client: fakeClient as never },
    ),
    (error) => error instanceof CommissionPolicySelectionError && error.code === "INVALID_COMMISSION_RATE",
  );

  console.log("PASS: #22 Slice C authoritative precedence, Slice A fallback and no-checkout-adoption contract");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
