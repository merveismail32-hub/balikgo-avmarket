import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { maskIban, maskTckn, maskVkn } from "./financial-identity-validation";
import { buildCurrentTaxVerificationContext, evaluateTaxVerificationApplicability } from "./tax-verification-domain";
import { evaluateCurrentBankDestination } from "./bank-destination-domain";
import { canReviewFinancialIdentity } from "./financial-review-domain";
import { evaluatePayoutTransferEligibility, meetsFinancialAssurance, type PayoutEligibilityReason } from "./payout-eligibility-domain";

export const FINANCE_REASON_PRESENTATION: Record<PayoutEligibilityReason, { category: "IDENTITY" | "OPERATIONS" | "PAYOUT" | "REFUND" | "HOLD" }> = {
  KYB_NOT_APPROVED: { category: "IDENTITY" }, SELLER_NOT_ACTIVATED: { category: "IDENTITY" }, SELLER_NOT_OPERATIONAL: { category: "OPERATIONS" }, TAX_VERIFICATION_REQUIRED: { category: "IDENTITY" }, BANK_VERIFICATION_REQUIRED: { category: "IDENTITY" }, FINANCIAL_HOLD_ACTIVE: { category: "HOLD" }, PAYOUT_NOT_AVAILABLE: { category: "PAYOUT" }, REFUND_OR_DISPUTE_BLOCK: { category: "REFUND" },
};
const financeSellerSelect = {
  id: true, userId: true, storeName: true, taxNumber: true, legalName: true, companyType: true, taxOffice: true, onboardingVersion: true, onboardingStatus: true, activationEligible: true, status: true, updatedAt: true,
  taxVerifications: { orderBy: { createdAt: "desc" as const } }, financialIdentity: { include: { currentBankDestinationRevision: true } },
  payouts: { select: { status: true, netAmount: true, currency: true, orderItem: { select: { refunds: { where: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED"] } }, select: { id: true }, take: 1 } } } } },
} satisfies Prisma.SellerProfileSelect;
type FinanceSellerRecord = Prisma.SellerProfileGetPayload<{ select: typeof financeSellerSelect }>;

function currentTax(profile: FinanceSellerRecord) {
  for (const verification of profile.taxVerifications) try { const context = buildCurrentTaxVerificationContext(profile, verification.identifierType); const applicability = evaluateTaxVerificationApplicability(verification, context); if (applicability.exactContext) return { verification, applicability }; } catch { /* fail closed */ }
  return null;
}
function currentBank(profile: FinanceSellerRecord) {
  const identity = profile.financialIdentity, revision = identity?.currentBankDestinationRevision;
  if (!identity || !revision) return null;
  const binding = evaluateCurrentBankDestination(identity, revision);
  return { identity, revision, binding, applicable: binding.current && revision.verificationStatus === "VERIFIED" && meetsFinancialAssurance(revision.verificationAssurance) };
}
function summaryStatus(reasons: PayoutEligibilityReason[], eligible: Prisma.Decimal) {
  if (eligible.greaterThan(0)) return "ELIGIBLE" as const;
  if (reasons.includes("FINANCIAL_HOLD_ACTIVE")) return "HELD" as const;
  if (reasons.some((reason) => ["TAX_VERIFICATION_REQUIRED", "BANK_VERIFICATION_REQUIRED", "KYB_NOT_APPROVED"].includes(reason))) return "VERIFICATION_REQUIRED" as const;
  if (reasons.includes("REFUND_OR_DISPUTE_BLOCK")) return "REFUND_OR_DISPUTE_BLOCK" as const;
  if (reasons.some((reason) => ["SELLER_NOT_OPERATIONAL", "SELLER_NOT_ACTIVATED"].includes(reason))) return "SELLER_INELIGIBLE" as const;
  return "NO_TRANSFERABLE_BALANCE" as const;
}
export function toFinanceSummaryDto(profile: FinanceSellerRecord) {
  const tax = currentTax(profile), bank = currentBank(profile), reasons = new Set<PayoutEligibilityReason>();
  const balances = new Map<string, { economic: Prisma.Decimal; eligible: Prisma.Decimal }>();
  for (const payout of profile.payouts) {
    const result = evaluatePayoutTransferEligibility({ onboardingStatus: profile.onboardingStatus, activationEligible: profile.activationEligible, sellerStatus: profile.status, taxTrusted: tax?.applicability.applicable ?? false, bankTrusted: bank?.applicable ?? false, holdActive: profile.financialIdentity?.holdActive ?? true, payoutStatus: payout.status, hasBlockingRefundOrDispute: payout.orderItem.refunds.length > 0 });
    const amount = balances.get(payout.currency) ?? { economic: new Prisma.Decimal(0), eligible: new Prisma.Decimal(0) };
    if (payout.status === "AVAILABLE") { amount.economic = amount.economic.plus(payout.netAmount); if (result.transferEligible) amount.eligible = amount.eligible.plus(payout.netAmount); else result.reasons.forEach((reason) => reasons.add(reason)); }
    balances.set(payout.currency, amount);
  }
  if (!profile.payouts.some((payout) => payout.status === "AVAILABLE")) reasons.add("PAYOUT_NOT_AVAILABLE");
  const balanceDtos = [...balances].map(([currency, amount]) => ({ currency, economicallyAvailableAmount: amount.economic.toFixed(2), transferEligibleAmount: amount.eligible.toFixed(2), temporarilyIneligibleAmount: amount.economic.minus(amount.eligible).toFixed(2) }));
  const reasonCodes = [...reasons], eligibleTotal = balanceDtos.reduce((sum, item) => sum.plus(item.transferEligibleAmount), new Prisma.Decimal(0)), taxType = tax?.verification.identifierType ?? null;
  return {
    seller: { id: profile.id, storeName: profile.storeName }, balances: balanceDtos, transferEligibility: { status: summaryStatus(reasonCodes, eligibleTotal), reasons: reasonCodes.map((code) => ({ code, ...FINANCE_REASON_PRESENTATION[code] })) },
    financialIdentityHold: { active: profile.financialIdentity?.holdActive ?? true, reasonCode: profile.financialIdentity?.holdReasonCode ?? "FINANCIAL_IDENTITY_INCOMPLETE", setAt: profile.financialIdentity?.holdSetAt?.toISOString() ?? null, releasedAt: profile.financialIdentity?.holdReleasedAt?.toISOString() ?? null },
    taxVerification: tax ? { identifierType: taxType, maskedIdentifier: taxType === "TCKN" ? maskTckn(profile.taxNumber) : maskVkn(profile.taxNumber), status: tax.verification.verificationStatus, assuranceLevel: tax.verification.verificationAssurance, current: tax.applicability.exactContext, applicable: tax.applicability.applicable, decidedAt: tax.verification.decidedAt?.toISOString() ?? null } : { identifierType: null, maskedIdentifier: "••••", status: "UNVERIFIED" as const, assuranceLevel: "LOCAL_CHECKS_ONLY" as const, current: false, applicable: false, decidedAt: null },
    bankVerification: bank ? { maskedIban: maskIban(bank.revision.canonicalIban), status: bank.revision.verificationStatus, assuranceLevel: bank.revision.verificationAssurance, destinationVersion: bank.revision.destinationVersion, current: bank.binding.current, applicable: bank.applicable, decidedAt: bank.revision.decidedAt?.toISOString() ?? null } : { maskedIban: "••••", status: "UNVERIFIED" as const, assuranceLevel: "LOCAL_CHECKS_ONLY" as const, destinationVersion: null, current: false, applicable: false, decidedAt: null },
    lastFinancialIdentityUpdateAt: [profile.updatedAt, profile.financialIdentity?.updatedAt, tax?.verification.decidedAt, bank?.revision.decidedAt].filter((value): value is Date => !!value).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null,
  };
}
async function loadFinanceSeller(where: { userId: string } | { id: string }, client: PrismaClient) { return client.sellerProfile.findFirst({ where, select: financeSellerSelect }); }
export async function getOwnSellerFinanceSummary(authenticatedUserId: string, client: PrismaClient = prisma) { const profile = await loadFinanceSeller({ userId: authenticatedUserId }, client); return profile ? toFinanceSummaryDto(profile) : null; }
export async function getAdminSellerFinanceSummary(authenticatedAdminId: string, sellerId: string, client: PrismaClient = prisma) { const actor = await client.user.findUnique({ where: { id: authenticatedAdminId }, select: { role: true } }); if (actor?.role !== "ADMIN") return null; const profile = await loadFinanceSeller({ id: sellerId }, client); return profile ? toFinanceSummaryDto(profile) : null; }
export async function getFinancialReviewerIdentityDetail(authenticatedReviewerId: string, sellerId: string, client: PrismaClient = prisma) {
  const reviewer = await client.user.findUnique({ where: { id: authenticatedReviewerId }, select: { role: true, financialIdentityReviewerEnabled: true } }); if (!canReviewFinancialIdentity(reviewer)) return null;
  const profile = await client.sellerProfile.findUnique({ where: { id: sellerId }, select: { id: true, taxNumber: true, financialIdentity: { select: { currentBankDestinationRevision: { select: { canonicalIban: true, beneficiaryName: true, destinationVersion: true } } } } } });
  return profile ? { sellerId: profile.id, taxIdentifier: profile.taxNumber, bankDestination: profile.financialIdentity?.currentBankDestinationRevision ?? null } : null;
}
