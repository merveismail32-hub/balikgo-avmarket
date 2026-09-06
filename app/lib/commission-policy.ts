import "server-only";

import { COMMISSION_DEFAULT_FALLBACK, parseCommissionRate } from "./commission";
import type { CommissionAgreementReadClient } from "./seller-category-commission-agreement";

export type CommissionPolicySource = "GLOBAL_CONFIG" | "DEFAULT_FALLBACK";
export type CommissionPolicyReasonCode = "GLOBAL_CONFIG_SELECTED" | "DEFAULT_FALLBACK_SELECTED";

export type CommissionPolicySelection = Readonly<{
  valid: true;
  rate: ReturnType<typeof parseCommissionRate>;
  source: CommissionPolicySource;
  sourceReference: "MARKETPLACE_COMMISSION_RATE" | "BUILT_IN_DEFAULT_0_10";
  fallback: boolean;
  reasonCode: CommissionPolicyReasonCode;
}>;

export class CommissionPolicySelectionError extends Error {
  readonly code = "INVALID_COMMISSION_RATE" as const;

  constructor() {
    super("INVALID_COMMISSION_RATE");
  }
}

export class CommissionPolicyResolutionError extends Error {
  readonly code = "AMBIGUOUS_COMMISSION_POLICY" as const;

  constructor() {
    super("AMBIGUOUS_COMMISSION_POLICY");
  }
}

export function selectCommissionPolicyFromServerConfig(configuredRate: string | undefined): CommissionPolicySelection {
  const fallback = configuredRate === undefined;
  try {
    return Object.freeze({
      valid: true,
      rate: parseCommissionRate(fallback ? COMMISSION_DEFAULT_FALLBACK : configuredRate),
      source: fallback ? "DEFAULT_FALLBACK" : "GLOBAL_CONFIG",
      sourceReference: fallback ? "BUILT_IN_DEFAULT_0_10" : "MARKETPLACE_COMMISSION_RATE",
      fallback,
      reasonCode: fallback ? "DEFAULT_FALLBACK_SELECTED" : "GLOBAL_CONFIG_SELECTED",
    });
  } catch {
    throw new CommissionPolicySelectionError();
  }
}

type ResolutionOptions = Readonly<{
  configuredRate?: string;
  client?: CommissionAgreementReadClient;
}>;

export async function resolveCommissionPolicy(
  input: Readonly<{ sellerId: string; categoryId: string; effectiveAt: Date }>,
  options: ResolutionOptions = {},
) {
  try {
    const { getEffectiveSellerCategoryCommissionAgreement } = await import("./seller-category-commission-agreement");
    const agreement = await getEffectiveSellerCategoryCommissionAgreement(
      { sellerId: input.sellerId, categoryId: input.categoryId, at: input.effectiveAt },
      options.client,
    );
    if (agreement) {
      return Object.freeze({
        ...agreement,
        fallback: false as const,
        reasonCode: "SELLER_CATEGORY_AGREEMENT_SELECTED" as const,
      });
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "OVERLAPPING_AGREEMENT") {
      throw new CommissionPolicyResolutionError();
    }
    throw error;
  }

  const configuredRate = Object.hasOwn(options, "configuredRate")
    ? options.configuredRate
    : process.env.MARKETPLACE_COMMISSION_RATE;
  return selectCommissionPolicyFromServerConfig(configuredRate);
}
