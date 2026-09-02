import type { Prisma } from "@prisma/client";
import { evaluateCurrentBankDestination } from "./bank-destination-domain";
import { maskIban, maskTckn, maskVkn } from "./financial-identity-validation";
import { meetsFinancialAssurance } from "./payout-eligibility-domain";
import { buildCurrentTaxVerificationContext, evaluateTaxVerificationApplicability } from "./tax-verification-domain";

export const adminSellerApplicationSummarySelect = {
  id: true, storeName: true, legalName: true, companyType: true, phone: true, taxNumber: true, taxOffice: true, city: true,
  address: true, categories: true, description: true, onboardingStatus: true, revisionReason: true, activationEligible: true,
  onboardingVersion: true,
  createdAt: true, submittedAt: true, authorizedPersonName: true, authorizedPersonSurname: true, authorizedPersonEmail: true, authorizedPersonTitle: true,
  user: { select: { name: true, surname: true, email: true, phone: true } }, kybDocuments: { select: { type: true, status: true } },
  taxVerifications: { orderBy: { createdAt: "desc" }, select: { sellerId: true, onboardingVersion: true, identifierType: true, normalizedFingerprint: true, verificationStatus: true, verificationAssurance: true, decidedAt: true } },
  financialIdentity: { select: { id: true, currentBankDestinationRevisionId: true, holdActive: true, holdReasonCode: true, currentBankDestinationRevision: { select: { id: true, financialIdentityId: true, destinationVersion: true, canonicalIban: true, beneficiaryName: true, normalizedFingerprint: true, verificationStatus: true, verificationAssurance: true, decidedAt: true } } } },
} satisfies Prisma.SellerProfileSelect;

type ApplicationSummaryRecord = Prisma.SellerProfileGetPayload<{ select: typeof adminSellerApplicationSummarySelect }>;

export function toAdminSellerApplicationSummaryDto(application: ApplicationSummaryRecord) {
  const maskedTaxIdentifier = application.taxNumber.replace(/\s/gu, "").length === 11 ? maskTckn(application.taxNumber) : maskVkn(application.taxNumber);
  const tax = application.taxVerifications.find((candidate) => {
    try { return evaluateTaxVerificationApplicability(candidate, buildCurrentTaxVerificationContext(application, candidate.identifierType)).exactContext; } catch { return false; }
  });
  const bank = application.financialIdentity?.currentBankDestinationRevision;
  const bankBinding = application.financialIdentity && bank ? evaluateCurrentBankDestination(application.financialIdentity, bank) : null;
  const { taxNumber: _taxNumber, taxVerifications: _taxVerifications, financialIdentity: _financialIdentity, ...safe } = application;
  void _taxNumber; void _taxVerifications; void _financialIdentity;
  return {
    ...safe,
    maskedTaxIdentifier,
    financialVerification: {
      tax: tax ? { status: tax.verificationStatus, assuranceLevel: tax.verificationAssurance, current: true, applicable: evaluateTaxVerificationApplicability(tax, buildCurrentTaxVerificationContext(application, tax.identifierType)).applicable, decidedAt: tax.decidedAt?.toISOString() ?? null } : { status: "UNVERIFIED" as const, assuranceLevel: "LOCAL_CHECKS_ONLY" as const, current: false, applicable: false, decidedAt: null },
      bank: bank && bankBinding ? { maskedIban: maskIban(bank.canonicalIban), status: bank.verificationStatus, assuranceLevel: bank.verificationAssurance, current: bankBinding.current, applicable: bankBinding.current && bank.verificationStatus === "VERIFIED" && meetsFinancialAssurance(bank.verificationAssurance), decidedAt: bank.decidedAt?.toISOString() ?? null } : { maskedIban: "••••", status: "UNVERIFIED" as const, assuranceLevel: "LOCAL_CHECKS_ONLY" as const, current: false, applicable: false, decidedAt: null },
      hold: { active: application.financialIdentity?.holdActive ?? true, reasonCode: application.financialIdentity?.holdReasonCode ?? "FINANCIAL_IDENTITY_INCOMPLETE" },
    },
    createdAt: application.createdAt.toISOString(), submittedAt: application.submittedAt?.toISOString() ?? null,
  };
}
