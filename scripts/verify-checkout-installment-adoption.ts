import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectInstallmentPolicyFromServerConfig } from "../app/lib/installment-policy";
import { createProviderInstallmentCapability } from "../app/lib/payments/installment-capability";
import { resolveEffectiveInstallments } from "../app/lib/payments/installment-resolution";

const root = resolve(import.meta.dirname, "..");
const checkout = readFileSync(resolve(root, "app/api/orders/route.ts"), "utf8");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(root, "prisma/migrations/20260906120000_payment_installment_snapshot/migration.sql"), "utf8");

assert.match(checkout, /requestedInstallmentCount:\s*z\.union\(\[z\.literal\(1\), z\.literal\(3\), z\.literal\(6\), z\.literal\(9\)\]\)\.optional\(\)/);
assert.equal((checkout.match(/resolveInstallmentsForProvider\(/g) ?? []).length, 1, "checkout must resolve installments once");
assert.match(checkout, /resolveInstallmentsForProvider[\s\S]*tx\.order\.create[\s\S]*tx\.payment\.create/);
assert.doesNotMatch(checkout, /resolveInstallmentsForProvider\(\{[^}]*sellerId|resolveInstallmentsForProvider\(\{[^}]*categoryId/, "installment authority must remain order-level for multi-seller orders");
assert.match(checkout, /selectedInstallmentCount:\s*installment\.selectedInstallmentCount/);
assert.match(checkout, /installmentPolicySource:\s*installment\.commercialProvenance\.source/);
assert.match(checkout, /installmentProviderCapabilityReference:\s*installment\.providerProvenance\.sourceReference/);
assert.doesNotMatch(checkout, /providerSupported\s*:\s*parsed\.data|commercialProvenance\s*:\s*parsed\.data/);
assert.match(schema, /selectedInstallmentCount\s+Int\?/);
assert.match(migration, /"selectedInstallmentCount" IN \(1, 3, 6, 9\)/);
assert.doesNotMatch(migration, /UPDATE\s+"Payment"|SET\s+"selectedInstallmentCount"/i, "legacy payments must not be backfilled");

const snapshot = resolveEffectiveInstallments({
  commercialPolicy: selectInstallmentPolicyFromServerConfig("1,3,6,9"),
  providerCapability: createProviderInstallmentCapability({ provider: "TEST", supportedInstallments: [1], sourceReference: "TEST_SINGLE_PAYMENT_V1" }),
});
const persistedShape = structuredClone(snapshot);
const changedPolicy = selectInstallmentPolicyFromServerConfig("1");
assert.equal(persistedShape.selectedInstallmentCount, 1);
assert.equal(persistedShape.commercialProvenance.sourceReference, "MARKETPLACE_ALLOWED_INSTALLMENTS");
assert.equal(persistedShape.providerProvenance.sourceReference, "TEST_SINGLE_PAYMENT_V1");
assert.equal(changedPolicy.allowedInstallments.length, 1);
assert.equal(persistedShape.commerciallyAllowed.length, 4, "later policy resolution must not mutate an existing snapshot");

console.log("PASS: #23 Slice D checkout adoption shape, single resolution, immutable snapshot and legacy-safe migration");
