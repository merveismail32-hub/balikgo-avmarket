import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateSellerInstallmentControl, parseInstallmentSet, SellerInstallmentControlError } from "../app/lib/seller-installment-control";

assert.deepEqual(parseInstallmentSet([1, 3, 6]), [1, 3, 6]);
assert.deepEqual(parseInstallmentSet([6, 1]), [1, 6]);
for (const invalid of [[], [3, 6], [1, 99], [1, 3, 3], "1,3", null]) {
  assert.throws(() => parseInstallmentSet(invalid), (error) => error instanceof SellerInstallmentControlError && error.code === "INVALID_ALLOWED_INSTALLMENTS");
}

assert.deepEqual(evaluateSellerInstallmentControl(null), {
  authorizationMode: "DISABLED",
  effectiveAllowedInstallments: [1],
  conflictReason: "CONTROL_MISSING",
  version: null,
});
assert.deepEqual(evaluateSellerInstallmentControl({ authorizationMode: "DELEGATED", delegatedAllowedInstallments: [1, 3, 6], participationEnabled: true, sellerPreferenceAllowedInstallments: [1, 6], version: 2 }), {
  authorizationMode: "DELEGATED",
  effectiveAllowedInstallments: [1, 6],
  conflictReason: null,
  version: 2,
});
assert.deepEqual(evaluateSellerInstallmentControl({ authorizationMode: "DELEGATED", delegatedAllowedInstallments: [1, 3], participationEnabled: true, sellerPreferenceAllowedInstallments: [1, 6], version: 3 }), {
  authorizationMode: "DELEGATED",
  effectiveAllowedInstallments: [1],
  conflictReason: "PREFERENCE_OUTSIDE_DELEGATION",
  version: 3,
});

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(root, "prisma/migrations/20260907120000_seller_installment_control/migration.sql"), "utf8");
const service = readFileSync(resolve(root, "app/lib/seller-installment-control.ts"), "utf8");
const sellerRoute = readFileSync(resolve(root, "app/api/seller/installment-control/route.ts"), "utf8");
const checkout = readFileSync(resolve(root, "app/api/orders/route.ts"), "utf8");

assert.match(schema, /model SellerInstallmentControl[\s\S]*sellerId\s+String\s+@unique[\s\S]*authorizationMode[\s\S]*delegatedAllowedInstallments\s+Json[\s\S]*participationEnabled\s+Boolean[\s\S]*sellerPreferenceAllowedInstallments\s+Json[\s\S]*version\s+Int/);
assert.match(schema, /model SellerInstallmentControlAudit[\s\S]*actorRole\s+UserRole[\s\S]*previousState\s+Json\?[\s\S]*newState\s+Json[\s\S]*expectedVersion\s+Int\?[\s\S]*newVersion\s+Int/);
assert.match(migration, /ON DELETE RESTRICT/g);
assert.match(migration, /SellerInstallmentControl_version_check/);
assert.match(migration, /delegatedAllowedInstallments[\s\S]*@> '\[1\]'::jsonb[\s\S]*<@ '\[1, 3, 6, 9\]'::jsonb/);
assert.doesNotMatch(migration, /(?:^|\n)\s*(?:UPDATE|DELETE FROM|DROP|TRUNCATE|INSERT INTO)\b/i, "migration must remain additive without business-row backfill");
assert.match(service, /TransactionIsolationLevel\.Serializable/);
assert.match(service, /SellerProfile[\s\S]*FOR UPDATE/);
assert.match(service, /version: expectedVersion[\s\S]*version: \{ increment: 1 \}/);
assert.match(service, /sellerInstallmentControlAudit\.create/);
assert.doesNotMatch(service, /financialAuditEvent/);
assert.match(sellerRoute, /\.strict\(\)/);
assert.doesNotMatch(sellerRoute, /authorizationMode|delegatedAllowedInstallments/, "seller DTO must not accept CEO-owned fields");
assert.doesNotMatch(checkout, /sellerInstallmentControl|setSellerInstallmentAuthorization|setOwnSellerInstallmentPreference/, "Slice B must not adopt control in checkout");

console.log("PASS: #24 Slice B domain, schema, authority DTO, audit and checkout-isolation contracts");
