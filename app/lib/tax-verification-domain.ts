import type { FinancialVerificationAssurance, Prisma, TaxVerification } from "@prisma/client";
import { taxIdentityFingerprint, validateTaxIdentifier, type LocalValidationResult, type TaxIdentifierTypeValue } from "./financial-identity-validation";

export const taxProfileContextSelect = {
  id: true,
  onboardingVersion: true,
  taxNumber: true,
  legalName: true,
  companyType: true,
  taxOffice: true,
} satisfies Prisma.SellerProfileSelect;

type TaxProfileContextSource = Prisma.SellerProfileGetPayload<{ select: typeof taxProfileContextSelect }>;
export type CurrentTaxVerificationContext = {
  sellerId: string;
  onboardingVersion: number;
  identifierType: TaxIdentifierTypeValue;
  normalizedFingerprint: string;
  localValidation: LocalValidationResult;
};

export class TaxVerificationError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID_LOCAL_IDENTITY" | "STALE_CONTEXT" | "IDEMPOTENCY_CONFLICT", message: string) {
    super(message);
    this.name = "TaxVerificationError";
  }
}

export function buildCurrentTaxVerificationContext(profile: TaxProfileContextSource, identifierType: TaxIdentifierTypeValue): CurrentTaxVerificationContext {
  const localValidation = validateTaxIdentifier(identifierType, profile.taxNumber);
  if (!localValidation.locallyValid) throw new TaxVerificationError("INVALID_LOCAL_IDENTITY", `Vergi kimliği yerel doğrulamadan geçmedi: ${localValidation.reasonCode}.`);
  return {
    sellerId: profile.id,
    onboardingVersion: profile.onboardingVersion,
    identifierType,
    normalizedFingerprint: taxIdentityFingerprint({
      sellerId: profile.id,
      onboardingVersion: profile.onboardingVersion,
      identifierType,
      canonicalIdentifier: localValidation.normalizedValue,
      legalName: profile.legalName,
      companyType: profile.companyType,
      taxOffice: profile.taxOffice,
    }),
    localValidation,
  };
}

const assuranceRank: Record<FinancialVerificationAssurance, number> = {
  LOCAL_CHECKS_ONLY: 0,
  DOCUMENT_REVIEWED: 1,
  PROVIDER_VERIFIED: 2,
  AUTHORITY_VERIFIED: 3,
};

type VerificationBinding = Pick<TaxVerification, "sellerId" | "onboardingVersion" | "identifierType" | "normalizedFingerprint" | "verificationStatus" | "verificationAssurance">;

export function evaluateTaxVerificationApplicability(
  verification: VerificationBinding,
  context: CurrentTaxVerificationContext,
  minimumAssurance: FinancialVerificationAssurance = "DOCUMENT_REVIEWED",
) {
  const exactContext = verification.sellerId === context.sellerId
    && verification.onboardingVersion === context.onboardingVersion
    && verification.identifierType === context.identifierType
    && verification.normalizedFingerprint === context.normalizedFingerprint;
  const workflowVerified = verification.verificationStatus === "VERIFIED";
  const assuranceSufficient = assuranceRank[verification.verificationAssurance] >= assuranceRank[minimumAssurance];
  return { exactContext, workflowVerified, assuranceSufficient, applicable: exactContext && workflowVerified && assuranceSufficient };
}
