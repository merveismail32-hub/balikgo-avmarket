import "server-only";

import {
  CANONICAL_INSTALLMENT_COUNTS,
  parseInstallmentCount,
  selectInstallmentPolicyFromServerConfig,
  type InstallmentCount,
  type InstallmentPolicySelection,
} from "../installment-policy";
import {
  createProviderInstallmentCapability,
  providerInstallmentCapabilityFor,
  type ProviderInstallmentCapability,
} from "./installment-capability";

export type EffectiveInstallmentResolutionErrorCode =
  | "NO_EFFECTIVE_INSTALLMENT_OPTION"
  | "INSTALLMENT_NOT_AVAILABLE";

export class EffectiveInstallmentResolutionError extends Error {
  constructor(readonly code: EffectiveInstallmentResolutionErrorCode) {
    super(code);
  }
}

export type EffectiveInstallmentResolution = Readonly<{
  commerciallyAllowed: readonly InstallmentCount[];
  providerSupported: readonly InstallmentCount[];
  effectiveAllowedInstallments: readonly InstallmentCount[];
  selectedInstallmentCount: InstallmentCount;
  commercialProvenance: Readonly<{
    source: InstallmentPolicySelection["source"];
    sourceReference: InstallmentPolicySelection["sourceReference"];
    policyVersion: InstallmentPolicySelection["policyVersion"];
  }>;
  providerProvenance: Readonly<{
    provider: string;
    source: ProviderInstallmentCapability["source"];
    sourceReference: string;
  }>;
}>;

export function resolveEffectiveInstallments(input: Readonly<{
  commercialPolicy: InstallmentPolicySelection;
  providerCapability: ProviderInstallmentCapability;
  requestedInstallmentCount?: unknown;
}>): EffectiveInstallmentResolution {
  const commercial = selectInstallmentPolicyFromServerConfig(
    input.commercialPolicy.source === "DEFAULT_FALLBACK"
      ? undefined
      : input.commercialPolicy.allowedInstallments.join(","),
  );
  const provider = createProviderInstallmentCapability({
    provider: input.providerCapability.provider,
    supportedInstallments: input.providerCapability.supportedInstallments,
    sourceReference: input.providerCapability.sourceReference,
  });
  const effectiveAllowedInstallments = Object.freeze(
    CANONICAL_INSTALLMENT_COUNTS.filter(
      (count) => commercial.allowedInstallments.includes(count) && provider.supportedInstallments.includes(count),
    ),
  );
  if (effectiveAllowedInstallments.length === 0) {
    throw new EffectiveInstallmentResolutionError("NO_EFFECTIVE_INSTALLMENT_OPTION");
  }

  const selectedInstallmentCount = input.requestedInstallmentCount === undefined
    ? effectiveAllowedInstallments.includes(1)
      ? 1
      : undefined
    : parseInstallmentCount(input.requestedInstallmentCount);
  if (selectedInstallmentCount === undefined || !effectiveAllowedInstallments.includes(selectedInstallmentCount)) {
    throw new EffectiveInstallmentResolutionError("INSTALLMENT_NOT_AVAILABLE");
  }

  return Object.freeze({
    commerciallyAllowed: Object.freeze([...commercial.allowedInstallments]),
    providerSupported: Object.freeze([...provider.supportedInstallments]),
    effectiveAllowedInstallments,
    selectedInstallmentCount,
    commercialProvenance: Object.freeze({
      source: commercial.source,
      sourceReference: commercial.sourceReference,
      policyVersion: commercial.policyVersion,
    }),
    providerProvenance: Object.freeze({
      provider: provider.provider,
      source: provider.source,
      sourceReference: provider.sourceReference,
    }),
  });
}

export function resolveInstallmentsForProvider(input: Readonly<{
  configuredAllowedInstallments: string | undefined;
  provider: string;
  requestedInstallmentCount?: unknown;
}>) {
  return resolveEffectiveInstallments({
    commercialPolicy: selectInstallmentPolicyFromServerConfig(input.configuredAllowedInstallments),
    providerCapability: providerInstallmentCapabilityFor(input.provider),
    requestedInstallmentCount: input.requestedInstallmentCount,
  });
}
