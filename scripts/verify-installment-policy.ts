import assert from "node:assert/strict";
import {
  InstallmentPolicyConfigError,
  parseInstallmentCount,
  selectInstallmentPolicyFromServerConfig,
} from "../app/lib/installment-policy";

for (const count of [1, 3, 6, 9] as const) {
  assert.equal(parseInstallmentCount(count), count);
  assert.equal(parseInstallmentCount(String(count)), count);
}

for (const invalid of [0, -1, 2, 4, 12, 99, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "", " ", "03", "invalid"]) {
  assert.throws(
    () => parseInstallmentCount(invalid),
    (error) => error instanceof InstallmentPolicyConfigError && error.code === "INVALID_INSTALLMENT_POLICY_CONFIG",
    `${String(invalid)} must fail closed`,
  );
}

const fallback = selectInstallmentPolicyFromServerConfig(undefined);
assert.deepEqual(fallback.allowedInstallments, [1]);
assert.equal(fallback.source, "DEFAULT_FALLBACK");
assert.equal(fallback.sourceReference, "BUILT_IN_SINGLE_PAYMENT");
assert.equal(fallback.policyVersion, "INSTALLMENT_POLICY_V1");
assert.equal(fallback.fallback, true);
assert.equal(fallback.reasonCode, "DEFAULT_FALLBACK_SELECTED");

for (const [raw, expected] of [
  ["1", [1]],
  ["1,3", [1, 3]],
  ["1,3,6,9", [1, 3, 6, 9]],
  ["9,3,3,1,6", [1, 3, 6, 9]],
] as const) {
  const selected = selectInstallmentPolicyFromServerConfig(raw);
  assert.deepEqual(selected.allowedInstallments, expected);
  assert.equal(selected.source, "GLOBAL_CONFIG");
  assert.equal(selected.sourceReference, "MARKETPLACE_ALLOWED_INSTALLMENTS");
  assert.equal(selected.fallback, false);
  assert.equal(selected.reasonCode, "GLOBAL_CONFIG_SELECTED");
}

const singlePaymentAdded = selectInstallmentPolicyFromServerConfig("3,6,9");
assert.deepEqual(singlePaymentAdded.allowedInstallments, [1, 3, 6, 9]);
assert.equal(singlePaymentAdded.reasonCode, "GLOBAL_CONFIG_SELECTED_WITH_SINGLE_PAYMENT");

for (const invalid of ["", " ", ",", "1,", ",1", "1,,3", "1,3,99", "0", "-1", "1.5", "1,three", "1, 3"]) {
  assert.throws(
    () => selectInstallmentPolicyFromServerConfig(invalid),
    (error) => error instanceof InstallmentPolicyConfigError && error.code === "INVALID_INSTALLMENT_POLICY_CONFIG",
    `${JSON.stringify(invalid)} must invalidate the entire policy`,
  );
}

assert.deepEqual(
  selectInstallmentPolicyFromServerConfig("9,3,3,1,6"),
  selectInstallmentPolicyFromServerConfig("9,3,3,1,6"),
  "same config must produce the same canonical policy and provenance",
);

console.log("PASS: #23 Slice B deterministic global installment policy with fail-closed configuration");
