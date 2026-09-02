import "server-only";

import { Prisma, type FinancialVerificationAssurance, type PrismaClient, type TaxVerification } from "@prisma/client";
import { prisma } from "./prisma";
import { buildCurrentTaxVerificationContext, evaluateTaxVerificationApplicability } from "./tax-verification-domain";
import { evaluateCurrentBankDestination } from "./bank-destination-domain";
import { evaluateFinancialIdentityTrust, evaluatePayoutTransferEligibility, meetsFinancialAssurance } from "./payout-eligibility-domain";
export { evaluateFinancialIdentityTrust, evaluatePayoutTransferEligibility, meetsFinancialAssurance } from "./payout-eligibility-domain";

const blockingRefundStatuses = ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED"] as const;
type TransactionHost = Pick<PrismaClient, "$transaction">;

function taxIsTrusted(profile: { id: string; onboardingVersion: number; taxNumber: string; legalName: string; companyType: string; taxOffice: string }, candidates: TaxVerification[]) {
  return candidates.some((candidate) => {
    try {
      const context = buildCurrentTaxVerificationContext(profile, candidate.identifierType);
      return evaluateTaxVerificationApplicability(candidate, context, "DOCUMENT_REVIEWED").applicable;
    } catch { return false; }
  });
}

function bankIsTrusted(identity: { id: string; currentBankDestinationRevisionId: string | null; currentBankDestinationRevision: null | { id: string; financialIdentityId: string; destinationVersion: number; canonicalIban: string; beneficiaryName: string; normalizedFingerprint: string; verificationStatus: string; verificationAssurance: FinancialVerificationAssurance } }) {
  const bank = identity.currentBankDestinationRevision;
  return !!bank && evaluateCurrentBankDestination(identity, bank).current && bank.verificationStatus === "VERIFIED" && meetsFinancialAssurance(bank.verificationAssurance);
}

export async function getPayoutTransferEligibility(payoutId: string, client: PrismaClient = prisma) {
  const payout = await client.sellerPayout.findUnique({ where: { id: payoutId }, include: {
    seller: { include: { financialIdentity: { include: { currentBankDestinationRevision: true } }, taxVerifications: true } },
    orderItem: { select: { refunds: { where: { status: { in: [...blockingRefundStatuses] } }, select: { id: true }, take: 1 } } },
  } });
  if (!payout) return null;
  const identity = payout.seller.financialIdentity;
  return evaluatePayoutTransferEligibility({
    onboardingStatus: payout.seller.onboardingStatus, activationEligible: payout.seller.activationEligible, sellerStatus: payout.seller.status,
    taxTrusted: taxIsTrusted(payout.seller, payout.seller.taxVerifications), bankTrusted: !!identity && bankIsTrusted(identity),
    holdActive: identity?.holdActive ?? true, payoutStatus: payout.status, hasBlockingRefundOrDispute: payout.orderItem.refunds.length > 0,
  });
}

export async function reconcileFinancialIdentityHold(input: { sellerId: string; expectedCoordinationVersion: number }, client: TransactionHost = prisma) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${input.sellerId} FOR UPDATE`;
    const seller = await tx.sellerProfile.findUnique({ where: { id: input.sellerId }, include: { taxVerifications: true } });
    if (!seller) return { released: false, reason: "NOT_FOUND" as const };
    await tx.$queryRaw`SELECT "id" FROM "SellerFinancialIdentity" WHERE "sellerId" = ${input.sellerId} FOR UPDATE`;
    const identity = await tx.sellerFinancialIdentity.findUnique({ where: { sellerId: input.sellerId }, include: { currentBankDestinationRevision: true } });
    if (!identity || identity.coordinationVersion !== input.expectedCoordinationVersion) return { released: false, reason: "STALE_CONTEXT" as const };
    const trust = evaluateFinancialIdentityTrust({ onboardingStatus: seller.onboardingStatus, activationEligible: seller.activationEligible, taxTrusted: taxIsTrusted(seller, seller.taxVerifications), bankTrusted: bankIsTrusted(identity) });
    if (!trust.trusted) return { released: false, reason: trust.reasons[0] ?? "FINANCIAL_IDENTITY_INCOMPLETE" };
    if (!identity.holdActive) return { released: false, reason: "ALREADY_RELEASED" as const };
    const released = await tx.sellerFinancialIdentity.updateMany({ where: { id: identity.id, sellerId: seller.id, coordinationVersion: input.expectedCoordinationVersion, currentBankDestinationRevisionId: identity.currentBankDestinationRevisionId, holdActive: true }, data: { holdActive: false, holdReasonCode: "IDENTITY_VERIFIED", holdReleasedAt: new Date(), coordinationVersion: { increment: 1 } } });
    return released.count === 1 ? { released: true, reason: null } : { released: false, reason: "STALE_CONTEXT" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
