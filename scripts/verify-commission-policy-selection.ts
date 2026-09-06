import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { commissionFor } from "../app/lib/commission";
import { CommissionPolicySelectionError, selectCommissionPolicyFromServerConfig } from "../app/lib/commission-policy";

const configured = selectCommissionPolicyFromServerConfig("0.0750");
assert.equal(configured.source, "GLOBAL_CONFIG");
assert.equal(configured.sourceReference, "MARKETPLACE_COMMISSION_RATE");
assert.equal(configured.fallback, false);
assert.equal(configured.reasonCode, "GLOBAL_CONFIG_SELECTED");
assert.equal(configured.rate.toString(), "0.075");

const fallback = selectCommissionPolicyFromServerConfig(undefined);
assert.equal(fallback.source, "DEFAULT_FALLBACK");
assert.equal(fallback.sourceReference, "BUILT_IN_DEFAULT_0_10");
assert.equal(fallback.fallback, true);
assert.equal(fallback.reasonCode, "DEFAULT_FALLBACK_SELECTED");
assert.equal(fallback.rate.toString(), "0.1");

for (const invalid of ["", "-0.01", "1.0001", "NaN", "invalid", "0.12345", " 0.10 "]) {
  assert.throws(
    () => selectCommissionPolicyFromServerConfig(invalid),
    (error) => error instanceof CommissionPolicySelectionError && error.code === "INVALID_COMMISSION_RATE",
    `${invalid} must fail closed`,
  );
}

assert.deepEqual(
  selectCommissionPolicyFromServerConfig("0.0750"),
  selectCommissionPolicyFromServerConfig("0.0750"),
  "selection must be deterministic",
);

const money = commissionFor(new Prisma.Decimal("10.05"), 3, configured.rate);
assert.equal(money.gross.toFixed(2), "30.15");
assert.equal(money.commission.toFixed(2), "2.26");
assert.equal(money.net.toFixed(2), "27.89");

const root = resolve(import.meta.dirname, "..");
const checkout = readFileSync(resolve(root, "app/api/orders/route.ts"), "utf8");
const policy = readFileSync(resolve(root, "app/lib/commission-policy.ts"), "utf8");
assert.match(checkout, /commissionRate:\s*money\.rate/);
assert.match(checkout, /commissionAmount:\s*money\.commission/);
assert.match(checkout, /sellerNetAmount:\s*money\.net/);
assert.match(checkout, /commissionForCheckoutLine/, "checkout must preserve the Commission Engine boundary through the authoritative adapter");
assert.doesNotMatch(policy, /coupon|promotion|campaign|installment|shipping/i);
assert.doesNotMatch(policy, /commissionAmount|sellerNet|payout|ledger|order\.(?:create|update)/i);

console.log("PASS: #22 Slice A deterministic global/fallback commission policy selection and preserved Commission Engine boundary");
