import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { Prisma } from "@prisma/client";
import { CommercialPolicyError } from "../app/lib/installment-commercial-policy";
import { EffectiveInstallmentResolutionError } from "../app/lib/payments/installment-resolution";
import { resolveCheckoutCommercialInstallments } from "../app/lib/payments/commercial-installment-resolution";

const at = new Date("2026-09-10T12:00:00.000Z");
const line = (sellerId: string, categoryId: string, sellerOfferId: string, amount = "100") => ({
  sellerId, categoryId, sellerOfferId, eligibleAmount: new Prisma.Decimal(amount),
});
const policy = (scopeKey: string, allowedInstallments: number[], id = scopeKey) => ({
  id, scopeKey, scopeType: scopeKey.split(":")[0], allowedInstallments, version: 1,
});
const delegated = (sellerId: string, preference: number[], options: { participation?: boolean; allowed?: number[]; mode?: string } = {}) => ({
  id: `control-${sellerId}`,
  sellerId,
  authorizationMode: options.mode ?? "DELEGATED",
  delegatedAllowedInstallments: options.allowed ?? [1, 3, 6],
  participationEnabled: options.participation ?? true,
  sellerPreferenceAllowedInstallments: preference,
  version: 2,
});
function client(policies: Record<string, ReturnType<typeof policy>[]>, controls: ReturnType<typeof delegated>[] = []) {
  return {
    installmentCommercialPolicy: {
      findMany: async ({ where }: { where: { scopeKey: string } }) => policies[where.scopeKey] ?? [],
    },
    sellerInstallmentControl: {
      findMany: async ({ where }: { where: { sellerId: { in: string[] } } }) =>
        controls.filter((control) => where.sellerId.in.includes(control.sellerId)),
    },
  } as never;
}
const legal = { status: "KNOWN" as const, allowedInstallments: [1, 3, 6, 9], source: "TEST_LEGAL", version: "1" };
const resolve = (lines: ReturnType<typeof line>[], policies: Record<string, ReturnType<typeof policy>[]>, controls: ReturnType<typeof delegated>[] = [], extra = {}) =>
  resolveCheckoutCommercialInstallments({ lines, effectiveAt: at, provider: "TEST", legalConstraint: legal, ...extra }, client(policies, controls));

async function main() {
assert.deepEqual((await resolve([line("s1", "c1", "o1")], {})).commercialAllowedInstallments, [1]);
assert.deepEqual((await resolve([line("s1", "c1", "o1")], { GLOBAL: [policy("GLOBAL", [1, 3, 6, 9])] }, [delegated("s1", [1, 6])])).commercialAllowedInstallments, [1, 6]);
assert.deepEqual((await resolve([line("s1", "c1", "o1")], {}, [delegated("s1", [1, 3], { participation: false })])).commercialAllowedInstallments, [1]);
assert.deepEqual((await resolve([line("s1", "c1", "o1")], {}, [delegated("s1", [1], { mode: "REQUEST_ONLY" })])).commercialAllowedInstallments, [1]);
assert.deepEqual((await resolve([line("s1", "c1", "o1")], {}, [delegated("s1", [1], { mode: "DISABLED" })])).commercialAllowedInstallments, [1]);
const conflict = await resolve([line("s1", "c1", "o1")], {}, [delegated("s1", [1, 6], { allowed: [1, 3] })]);
assert.deepEqual(conflict.commercialAllowedInstallments, [1]);
assert.equal((conflict.internalSnapshot.sellerControls as Array<{ conflictReason: string }>)[0].conflictReason, "PREFERENCE_OUTSIDE_DELEGATION");
const allScopes = {
  GLOBAL: [policy("GLOBAL", [1, 3, 6, 9])],
  "CATEGORY:c1": [policy("CATEGORY:c1", [1, 3, 6])],
  "SELLER:s1": [policy("SELLER:s1", [1, 3])],
  "SELLER_CATEGORY:s1:c1": [policy("SELLER_CATEGORY:s1:c1", [1, 3])],
  "SELLER_OFFER:o1": [policy("SELLER_OFFER:o1", [1])],
};
assert.deepEqual((await resolve([line("s1", "c1", "o1")], allScopes, [delegated("s1", [1, 3])])).commercialAllowedInstallments, [1]);
assert.deepEqual((await resolve(
  [line("s1", "c1", "o1"), line("s2", "c2", "o2")],
  { "SELLER:s1": [policy("SELLER:s1", [1, 3, 6])], "SELLER:s2": [policy("SELLER:s2", [1, 3])] },
  [delegated("s1", [1, 3, 6]), delegated("s2", [1, 3])],
)).commercialAllowedInstallments, [1, 3]);
assert.deepEqual((await resolve(
  [line("s1", "c1", "o1"), line("s1", "c2", "o2")],
  { "CATEGORY:c1": [policy("CATEGORY:c1", [1, 3, 6])], "CATEGORY:c2": [policy("CATEGORY:c2", [1, 3])] },
  [delegated("s1", [1, 3, 6])],
)).commercialAllowedInstallments, [1, 3]);
assert.deepEqual((await resolve([line("s1", "c1", "o1")], {}, [delegated("s1", [1, 3])], { legalConstraint: { status: "UNKNOWN" } })).legalAllowedInstallments, [1]);
assert.deepEqual((await resolve([line("s1", "c1", "o1")], { GLOBAL: [policy("GLOBAL", [1, 3, 6, 9])] }, [delegated("s1", [1, 3, 6, 9])])).resolution.effectiveAllowedInstallments, [1]);
await assert.rejects(
  resolve([line("s1", "c1", "o1")], {}, [delegated("s1", [1, 3])], { requestedInstallmentCount: 3 }),
  (error) => error instanceof EffectiveInstallmentResolutionError && error.code === "INSTALLMENT_NOT_AVAILABLE",
);
assert.equal((await resolve([line("s1", "c1", "o1")], {}, [], { requestedInstallmentCount: 1 })).resolution.selectedInstallmentCount, 1);
await assert.rejects(
  resolve([line("s1", "c1", "o1")], { GLOBAL: [policy("GLOBAL", [1]), policy("GLOBAL", [1], "second")] }),
  (error) => error instanceof CommercialPolicyError && error.code === "AMBIGUOUS_POLICY",
);
const root = resolvePath(import.meta.dirname, "..");
const checkout = readFileSync(resolvePath(root, "app/api/orders/route.ts"), "utf8");
const migration = readFileSync(resolvePath(root, "prisma/migrations/20260910120000_payment_commercial_installment_snapshot/migration.sql"), "utf8");
const customerSelect = readFileSync(resolvePath(root, "app/lib/customer-order-select.ts"), "utf8");
assert.equal((checkout.match(/resolveCheckoutCommercialInstallments\(/g) ?? []).length, 1);
assert.doesNotMatch(checkout, /sellerId:\s*parsed\.data|categoryId:\s*parsed\.data|allowedInstallments:\s*parsed\.data/);
assert.match(checkout, /installmentCommercialSnapshot:\s*installmentDecision\.internalSnapshot/);
assert.match(checkout, /TransactionIsolationLevel\.RepeatableRead/);
assert.doesNotMatch(customerSelect, /installmentCommercialSnapshot|installmentPolicyReference|installmentProviderCapabilityReference/);
assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE FROM|INSERT INTO|DROP|TRUNCATE)\b/i);
console.log("PASS: #24 Slice E scoped intersections, seller clamps, legal fail-closed, multi-line and #23 provider/request boundaries");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
