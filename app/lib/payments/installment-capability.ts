import "server-only";

import {
  CANONICAL_INSTALLMENT_COUNTS,
  InstallmentPolicyConfigError,
  parseInstallmentCount,
  type InstallmentCount,
} from "../installment-policy";

export type ProviderInstallmentCapability = Readonly<{
  provider: string;
  supportedInstallments: readonly InstallmentCount[];
  source: "PROVIDER_CAPABILITY";
  sourceReference: string;
}>;

export type ProviderInstallmentCapabilityErrorCode =
  | "UNKNOWN_PAYMENT_PROVIDER"
  | "INVALID_PROVIDER_INSTALLMENT_CAPABILITY";

export class ProviderInstallmentCapabilityError extends Error {
  constructor(readonly code: ProviderInstallmentCapabilityErrorCode) {
    super(code);
  }
}

export function createProviderInstallmentCapability(input: Readonly<{
  provider: string;
  supportedInstallments: readonly unknown[];
  sourceReference: string;
}>): ProviderInstallmentCapability {
  if (!input.provider || !input.sourceReference || input.supportedInstallments.length === 0) {
    throw new ProviderInstallmentCapabilityError("INVALID_PROVIDER_INSTALLMENT_CAPABILITY");
  }

  let parsed: InstallmentCount[];
  try {
    parsed = input.supportedInstallments.map(parseInstallmentCount);
  } catch (error) {
    if (error instanceof InstallmentPolicyConfigError) {
      throw new ProviderInstallmentCapabilityError("INVALID_PROVIDER_INSTALLMENT_CAPABILITY");
    }
    throw error;
  }

  const supportedInstallments = Object.freeze(
    CANONICAL_INSTALLMENT_COUNTS.filter((count) => parsed.includes(count)),
  );
  return Object.freeze({
    provider: input.provider,
    supportedInstallments,
    source: "PROVIDER_CAPABILITY" as const,
    sourceReference: input.sourceReference,
  });
}

export function providerInstallmentCapabilityFor(provider: string): ProviderInstallmentCapability {
  if (provider === "TEST") {
    return createProviderInstallmentCapability({
      provider,
      supportedInstallments: [1],
      sourceReference: "TEST_SINGLE_PAYMENT_V1",
    });
  }
  throw new ProviderInstallmentCapabilityError("UNKNOWN_PAYMENT_PROVIDER");
}
