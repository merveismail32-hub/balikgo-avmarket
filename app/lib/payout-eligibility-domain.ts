import type { FinancialVerificationAssurance, PayoutStatus, SellerOnboardingStatus, SellerStatus } from "@prisma/client";

export type PayoutEligibilityReason = "KYB_NOT_APPROVED" | "SELLER_NOT_ACTIVATED" | "SELLER_NOT_OPERATIONAL" | "TAX_VERIFICATION_REQUIRED" | "BANK_VERIFICATION_REQUIRED" | "FINANCIAL_HOLD_ACTIVE" | "PAYOUT_NOT_AVAILABLE" | "REFUND_OR_DISPUTE_BLOCK";

const assuranceRank: Record<FinancialVerificationAssurance, number> = { LOCAL_CHECKS_ONLY: 0, DOCUMENT_REVIEWED: 1, PROVIDER_VERIFIED: 2, AUTHORITY_VERIFIED: 3 };
export function meetsFinancialAssurance(actual: FinancialVerificationAssurance, minimum: FinancialVerificationAssurance = "DOCUMENT_REVIEWED") {
  return assuranceRank[actual] >= assuranceRank[minimum];
}

export function evaluateFinancialIdentityTrust(input: { onboardingStatus: SellerOnboardingStatus; activationEligible: boolean; taxTrusted: boolean; bankTrusted: boolean }) {
  const reasons: PayoutEligibilityReason[] = [];
  if (input.onboardingStatus !== "APPROVED") reasons.push("KYB_NOT_APPROVED");
  if (!input.activationEligible) reasons.push("SELLER_NOT_ACTIVATED");
  if (!input.taxTrusted) reasons.push("TAX_VERIFICATION_REQUIRED");
  if (!input.bankTrusted) reasons.push("BANK_VERIFICATION_REQUIRED");
  return { trusted: reasons.length === 0, reasons };
}

export function evaluatePayoutTransferEligibility(input: {
  onboardingStatus: SellerOnboardingStatus;
  activationEligible: boolean;
  sellerStatus: SellerStatus;
  taxTrusted: boolean;
  bankTrusted: boolean;
  holdActive: boolean;
  payoutStatus: PayoutStatus;
  hasBlockingRefundOrDispute: boolean;
}) {
  const identity = evaluateFinancialIdentityTrust(input);
  const reasons = [...identity.reasons];
  if (input.sellerStatus !== "APPROVED") reasons.push("SELLER_NOT_OPERATIONAL");
  if (input.holdActive) reasons.push("FINANCIAL_HOLD_ACTIVE");
  if (input.payoutStatus !== "AVAILABLE") reasons.push("PAYOUT_NOT_AVAILABLE");
  if (input.hasBlockingRefundOrDispute) reasons.push("REFUND_OR_DISPUTE_BLOCK");
  return { transferEligible: reasons.length === 0, reasons: [...new Set(reasons)] };
}
