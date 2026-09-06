import assert from "node:assert/strict";
import { InstallmentPolicyConfigError, selectInstallmentPolicyFromServerConfig } from "../app/lib/installment-policy";
import {
  createProviderInstallmentCapability,
  providerInstallmentCapabilityFor,
  ProviderInstallmentCapabilityError,
} from "../app/lib/payments/installment-capability";
import {
  EffectiveInstallmentResolutionError,
  resolveEffectiveInstallments,
  resolveInstallmentsForProvider,
} from "../app/lib/payments/installment-resolution";

const testCapability = providerInstallmentCapabilityFor("TEST");
assert.deepEqual(testCapability.supportedInstallments, [1]);
assert.equal(testCapability.provider, "TEST");
assert.equal(testCapability.source, "PROVIDER_CAPABILITY");
assert.equal(testCapability.sourceReference, "TEST_SINGLE_PAYMENT_V1");
assert.throws(
  () => providerInstallmentCapabilityFor("UNKNOWN"),
  (error) => error instanceof ProviderInstallmentCapabilityError && error.code === "UNKNOWN_PAYMENT_PROVIDER",
);

function capability(supportedInstallments: readonly unknown[]) {
  return createProviderInstallmentCapability({
    provider: "FIXTURE",
    supportedInstallments,
    sourceReference: "TARGETED_TEST_FIXTURE",
  });
}

function resolve(commercial: string, provider: readonly unknown[], requestedInstallmentCount?: unknown) {
  return resolveEffectiveInstallments({
    commercialPolicy: selectInstallmentPolicyFromServerConfig(commercial),
    providerCapability: capability(provider),
    requestedInstallmentCount,
  });
}

assert.deepEqual(resolve("1,3,6,9", [1]).effectiveAllowedInstallments, [1]);
assert.deepEqual(resolve("1,3", [1, 3]).effectiveAllowedInstallments, [1, 3]);
assert.deepEqual(resolve("1,3", [1, 6]).effectiveAllowedInstallments, [1]);
assert.deepEqual(resolve("1", [1, 3, 6, 9]).effectiveAllowedInstallments, [1]);
assert.equal(resolve("1", [1], 1).selectedInstallmentCount, 1);
assert.throws(
  () => resolve("1,3,6,9", [1], 3),
  (error) => error instanceof EffectiveInstallmentResolutionError && error.code === "INSTALLMENT_NOT_AVAILABLE",
);
assert.equal(resolve("1,3", [1, 3], 3).selectedInstallmentCount, 3);
assert.equal(resolve("1,3", [1, 3]).selectedInstallmentCount, 1);
assert.throws(
  () => resolve("1", [3]),
  (error) => error instanceof EffectiveInstallmentResolutionError && error.code === "NO_EFFECTIVE_INSTALLMENT_OPTION",
);
assert.throws(
  () => capability([1, 99]),
  (error) => error instanceof ProviderInstallmentCapabilityError && error.code === "INVALID_PROVIDER_INSTALLMENT_CAPABILITY",
);

const normalized = capability([9, 3, 3, 1, 6]);
assert.deepEqual(normalized.supportedInstallments, [1, 3, 6, 9]);
assert.deepEqual(normalized, capability([9, 3, 3, 1, 6]));
assert.deepEqual(resolve("9,3,3,1,6", [9, 3, 3, 1, 6], 6), resolve("9,3,3,1,6", [9, 3, 3, 1, 6], 6));

for (const invalidRequest of [0, -1, 2, 4, 12, 99, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "invalid"]) {
  assert.throws(() => resolve("1,3,6,9", [1, 3, 6, 9], invalidRequest));
}

assert.throws(
  () => resolveInstallmentsForProvider({ configuredAllowedInstallments: "1,99", provider: "TEST" }),
  (error) => error instanceof InstallmentPolicyConfigError && error.code === "INVALID_INSTALLMENT_POLICY_CONFIG",
  "provider resolution must not mask or replace an invalid commercial policy",
);

console.log("PASS: #23 Slice C authoritative provider capability and deterministic effective installment resolution");
