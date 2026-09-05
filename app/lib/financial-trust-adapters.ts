import type { FinancialVerificationAssurance, FinancialVerificationSource, FinancialVerificationStatus, TaxVerification } from "@prisma/client";
import { evaluatePayoutTransferEligibility, meetsFinancialAssurance } from "./payout-eligibility-domain";
import { evaluateTaxVerificationApplicability, type CurrentTaxVerificationContext } from "./tax-verification-domain";
import { compareTrustBinding, evaluateApplicability, type ApplicabilityDecision, type TrustBinding } from "./trust-primitives";
import { safeMaskedSubject, safeReasonCodes, safeTimestamp, type SafeTrustView } from "./safe-trust-read-model";

type EvidenceContext = Readonly<{ evidencePresent: boolean; sourceAuthenticated: boolean }>;
type TaxTrustRecord = Pick<TaxVerification, "sellerId" | "onboardingVersion" | "identifierType" | "normalizedFingerprint" | "verificationStatus" | "verificationSource" | "verificationAssurance">;

export function evaluateTaxTrust(
  verification: TaxTrustRecord,
  context: CurrentTaxVerificationContext,
  evidence: EvidenceContext,
  minimumAssurance: FinancialVerificationAssurance = "DOCUMENT_REVIEWED",
): ApplicabilityDecision {
  const expected = { parts: [context.sellerId, context.onboardingVersion, context.identifierType, context.normalizedFingerprint, "TAX_VERIFICATION"] } as const satisfies TrustBinding;
  const observed = { parts: [verification.sellerId, verification.onboardingVersion, verification.identifierType, verification.normalizedFingerprint, "TAX_VERIFICATION"] } as const satisfies TrustBinding;
  const bindingMatches = compareTrustBinding(expected, observed);
  const finance = evaluateTaxVerificationApplicability(verification, context, minimumAssurance);
  return evaluateApplicability({
    verified: verification.verificationStatus === "VERIFIED",
    source: { kind: verification.verificationSource, authenticated: evidence.sourceAuthenticated, evidencePresent: evidence.evidencePresent },
    bindingMatches,
    current: bindingMatches && finance.exactContext,
    policySatisfied: finance.assuranceSufficient,
  });
}

type BankTrustRecord = Readonly<{
  id: string;
  financialIdentityId: string;
  destinationVersion: number;
  normalizedFingerprint: string;
  verificationStatus: FinancialVerificationStatus;
  verificationSource: FinancialVerificationSource;
  verificationAssurance: FinancialVerificationAssurance;
}>;

export function evaluateBankDestinationTrust(input: Readonly<{
  expectedSellerId: string;
  observedSellerId: string;
  identity: { id: string; currentBankDestinationRevisionId: string | null };
  revision: BankTrustRecord;
  currentEvaluation: Readonly<{ current: boolean }>;
  evidence: EvidenceContext;
  minimumAssurance?: FinancialVerificationAssurance;
}>): ApplicabilityDecision {
  const expected = { parts: [input.expectedSellerId, input.identity.id, input.identity.currentBankDestinationRevisionId, input.revision.destinationVersion, input.revision.normalizedFingerprint, "BANK_DESTINATION"] } as const satisfies TrustBinding;
  const observed = { parts: [input.observedSellerId, input.revision.financialIdentityId, input.revision.id, input.revision.destinationVersion, input.revision.normalizedFingerprint, "BANK_DESTINATION"] } as const satisfies TrustBinding;
  const bindingMatches = compareTrustBinding(expected, observed);
  return evaluateApplicability({
    verified: input.revision.verificationStatus === "VERIFIED",
    source: { kind: input.revision.verificationSource, authenticated: input.evidence.sourceAuthenticated, evidencePresent: input.evidence.evidencePresent },
    bindingMatches,
    current: bindingMatches && input.currentEvaluation.current,
    policySatisfied: meetsFinancialAssurance(input.revision.verificationAssurance, input.minimumAssurance),
  });
}

type PayoutPolicyInput = Parameters<typeof evaluatePayoutTransferEligibility>[0];

export function evaluatePayoutTrust(input: Omit<PayoutPolicyInput, "taxTrusted" | "bankTrusted"> & Readonly<{
  tax: ApplicabilityDecision;
  bank: ApplicabilityDecision;
}>) {
  const result = evaluatePayoutTransferEligibility({
    onboardingStatus: input.onboardingStatus,
    activationEligible: input.activationEligible,
    sellerStatus: input.sellerStatus,
    taxTrusted: input.tax.applicable,
    bankTrusted: input.bank.applicable,
    holdActive: input.holdActive,
    payoutStatus: input.payoutStatus,
    hasBlockingRefundOrDispute: input.hasBlockingRefundOrDispute,
  });
  return { ...result, applicable: result.transferEligible, tax: input.tax, bank: input.bank } as const;
}

export type FinancialTrustView = SafeTrustView<FinancialVerificationStatus, FinancialVerificationSource, string>;

export function toFinancialTrustView(input: Readonly<{
  status: FinancialVerificationStatus;
  source: FinancialVerificationSource;
  sourceAuthenticated: boolean;
  decision: ApplicabilityDecision;
  observedAt?: Date | null;
  verifiedAt?: Date | null;
  changedAt?: Date | null;
  revoked?: boolean;
  expired?: boolean;
  superseded?: boolean;
  maskedSubject?: string;
}>): FinancialTrustView {
  const subjectSummary = safeMaskedSubject(input.maskedSubject);
  return {
    outcome: input.status,
    source: { category: input.source, authenticity: input.sourceAuthenticated ? "AUTHENTICATED" : "UNAUTHENTICATED" },
    trusted: input.decision.trusted,
    current: input.decision.current,
    applicable: input.decision.applicable,
    reasonCodes: safeReasonCodes(input.decision.reasonCodes),
    invalidation: {
      stale: !input.decision.current,
      revoked: input.revoked === true,
      expired: input.expired === true,
      superseded: input.superseded === true,
    },
    observedAt: safeTimestamp(input.observedAt),
    verifiedAt: safeTimestamp(input.verifiedAt),
    changedAt: safeTimestamp(input.changedAt),
    ...(subjectSummary ? { subjectSummary } : {}),
  };
}
