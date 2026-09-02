import "server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Prisma, type TaxIdentifierType } from "@prisma/client";
import { createGuardedTestPrisma } from "./guarded-test-prisma";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";
import { recordCurrentTaxLocalValidation } from "../app/lib/tax-verification";
import { buildCurrentTaxVerificationContext, evaluateTaxVerificationApplicability } from "../app/lib/tax-verification-domain";
import { setCurrentBankDestination } from "../app/lib/bank-destination";
import { reviewBankDestination, reviewTaxVerification } from "../app/lib/financial-review";
import { FinancialReviewError } from "../app/lib/financial-review-domain";

const env = hydrateVerifiedTestEnvironment(process.env, resolve(import.meta.dirname, ".."));
const prisma = createGuardedTestPrisma({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT_PATH: env.SUPABASE_CA_CERT_PATH });
const ids = { users: [] as string[], sellers: [] as string[] };
const key = () => randomUUID();
const ibanA = "TR470000100100000350930001";
const ibanB = "TR330006100519786457841326";

async function createUser(label: string, role: "SELLER" | "ADMIN", reviewer: boolean, withSeller = false) {
  const token = key();
  const user = await prisma.user.create({ data: {
    name: "Review", surname: label, email: `slice-e-${token}@invalid.local`, phone: "0", passwordHash: "qa", role, financialIdentityReviewerEnabled: reviewer,
    ...(withSeller ? { sellerProfile: { create: { storeName: `Slice-E-${label}`, storeSlug: `slice-e-${token}`, legalName: `Slice E ${label} A.Ş.`, companyType: "Anonim Şirket", taxNumber: "10000000146", taxOffice: "Kadıköy", city: "QA", address: "QA", description: "QA" } } } : {}),
  }, include: { sellerProfile: true } });
  ids.users.push(user.id); if (user.sellerProfile) ids.sellers.push(user.sellerProfile.id);
  return user;
}

async function cleanup() {
  if (ids.sellers.length) {
    await prisma.financialVerificationEvidence.deleteMany({ where: { sellerId: { in: ids.sellers } } });
    const identities = await prisma.sellerFinancialIdentity.findMany({ where: { sellerId: { in: ids.sellers } }, select: { id: true } });
    if (identities.length) {
      await prisma.sellerFinancialIdentity.updateMany({ where: { id: { in: identities.map(({ id }) => id) } }, data: { currentBankDestinationRevisionId: null } });
      await prisma.bankDestinationRevision.deleteMany({ where: { financialIdentityId: { in: identities.map(({ id }) => id) } } });
      await prisma.sellerFinancialIdentity.deleteMany({ where: { id: { in: identities.map(({ id }) => id) } } });
    }
    await prisma.taxVerification.deleteMany({ where: { sellerId: { in: ids.sellers } } });
    await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  }
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}

const taxInput = (target: { id: string; onboardingVersion: number; identifierType: TaxIdentifierType; normalizedFingerprint: string }, decision: "APPROVE" | "REJECT", idempotencyKey = `slice-e-tax-review-${key()}`) => ({
  taxVerificationId: target.id, expectedOnboardingVersion: target.onboardingVersion, expectedIdentifierType: target.identifierType,
  expectedFingerprint: target.normalizedFingerprint, decision, reasonCode: decision === "APPROVE" ? "DOCUMENTS_MATCH" : "DOCUMENTS_MISMATCH",
  evidenceReference: `vault://slice-e/${key()}`, idempotencyKey,
});

const bankInput = (target: { id: string; destinationVersion: number; normalizedFingerprint: string }, coordinationVersion: number, decision: "APPROVE" | "REJECT", idempotencyKey = `slice-e-bank-review-${key()}`) => ({
  bankDestinationRevisionId: target.id, expectedCoordinationVersion: coordinationVersion, expectedDestinationVersion: target.destinationVersion,
  expectedFingerprint: target.normalizedFingerprint, decision, reasonCode: decision === "APPROVE" ? "DOCUMENTS_MATCH" : "DOCUMENTS_MISMATCH",
  evidenceReference: `vault://slice-e/${key()}`, idempotencyKey,
});

async function main() {
  await cleanup();
  try {
    const seller = await createUser("Seller", "SELLER", false, true);
    const adminNoCapability = await createUser("AdminNoCapability", "ADMIN", false);
    const flaggedSeller = await createUser("FlaggedSeller", "SELLER", true);
    const reviewerA = await createUser("ReviewerA", "ADMIN", true);
    const reviewerB = await createUser("ReviewerB", "ADMIN", true);
    const selfReviewer = await createUser("SelfReviewer", "ADMIN", true, true);

    const tax = await recordCurrentTaxLocalValidation({ sellerId: seller.sellerProfile!.id, expectedOnboardingVersion: 0, identifierType: "TCKN", idempotencyKey: `slice-e-tax-${key()}` }, prisma);
    await assert.rejects(reviewTaxVerification({ authenticatedUserId: adminNoCapability.id }, taxInput(tax, "APPROVE"), prisma), (e: unknown) => e instanceof FinancialReviewError && e.code === "FORBIDDEN");
    await assert.rejects(reviewTaxVerification({ authenticatedUserId: flaggedSeller.id }, taxInput(tax, "APPROVE"), prisma), (e: unknown) => e instanceof FinancialReviewError && e.code === "FORBIDDEN");
    await assert.rejects(reviewTaxVerification({ authenticatedUserId: reviewerA.id }, { ...taxInput(tax, "APPROVE"), evidenceReference: "" }, prisma), (e: unknown) => e instanceof FinancialReviewError && e.code === "INVALID_INPUT");

    const selfTax = await recordCurrentTaxLocalValidation({ sellerId: selfReviewer.sellerProfile!.id, expectedOnboardingVersion: 0, identifierType: "TCKN", idempotencyKey: `slice-e-self-tax-${key()}` }, prisma);
    await assert.rejects(reviewTaxVerification({ authenticatedUserId: selfReviewer.id }, taxInput(selfTax, "APPROVE"), prisma), (e: unknown) => e instanceof FinancialReviewError && e.code === "FORBIDDEN");

    const approveKey = `slice-e-tax-approve-${key()}`;
    const approved = await reviewTaxVerification({ authenticatedUserId: reviewerA.id }, taxInput(tax, "APPROVE", approveKey), prisma);
    assert.equal(approved.target.verificationStatus, "VERIFIED");
    assert.equal(approved.target.verificationSource, "MANUAL");
    assert.equal(approved.target.verificationAssurance, "DOCUMENT_REVIEWED");
    assert.equal(approved.target.reviewerUserId, reviewerA.id);
    assert.equal(approved.evidence.reviewerUserId, reviewerA.id);
    assert.equal(approved.evidence.reasonCode, "MANUAL_APPROVE:DOCUMENTS_MATCH");
    assert.equal(approved.evidence.verificationSource, "MANUAL");
    assert.equal(approved.evidence.verificationAssurance, "DOCUMENT_REVIEWED");
    const replay = await reviewTaxVerification({ authenticatedUserId: reviewerA.id }, taxInput(tax, "APPROVE", approveKey), prisma);
    assert.equal(replay.evidence.id, approved.evidence.id);
    assert.equal(replay.replay, true);
    await assert.rejects(reviewTaxVerification({ authenticatedUserId: reviewerA.id }, taxInput(tax, "REJECT", approveKey), prisma), (e: unknown) => e instanceof FinancialReviewError && e.code === "IDEMPOTENCY_CONFLICT");

    const staleSeller = await createUser("StaleTax", "SELLER", false, true);
    const staleTax = await recordCurrentTaxLocalValidation({ sellerId: staleSeller.sellerProfile!.id, expectedOnboardingVersion: 0, identifierType: "TCKN", idempotencyKey: `slice-e-stale-tax-${key()}` }, prisma);
    await prisma.sellerProfile.update({ where: { id: staleSeller.sellerProfile!.id }, data: { onboardingVersion: { increment: 1 }, legalName: "Changed Legal Name" } });
    await assert.rejects(reviewTaxVerification({ authenticatedUserId: reviewerA.id }, taxInput(staleTax, "APPROVE"), prisma), (e: unknown) => e instanceof FinancialReviewError && e.code === "STALE_CONTEXT");

    const taxRaceSeller = await createUser("TaxRace", "SELLER", false, true);
    const taxRace = await recordCurrentTaxLocalValidation({ sellerId: taxRaceSeller.sellerProfile!.id, expectedOnboardingVersion: 0, identifierType: "TCKN", idempotencyKey: `slice-e-tax-race-${key()}` }, prisma);
    const taxRaceResults = await Promise.allSettled([
      reviewTaxVerification({ authenticatedUserId: reviewerA.id }, taxInput(taxRace, "APPROVE"), prisma),
      prisma.sellerProfile.update({ where: { id: taxRaceSeller.sellerProfile!.id }, data: { onboardingVersion: { increment: 1 }, taxOffice: "Changed Office" } }),
    ]);
    assert(taxRaceResults.some((result) => result.status === "fulfilled"));
    const currentTaxProfile = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: taxRaceSeller.sellerProfile!.id }, select: { id: true, onboardingVersion: true, taxNumber: true, legalName: true, companyType: true, taxOffice: true } });
    const currentTaxContext = buildCurrentTaxVerificationContext(currentTaxProfile, "TCKN");
    const historicalTax = await prisma.taxVerification.findUniqueOrThrow({ where: { id: taxRace.id } });
    assert.equal(evaluateTaxVerificationApplicability(historicalTax, currentTaxContext).applicable, false, "racing tax review authorized changed KYB identity");

    const contradictoryTaxSeller = await createUser("TaxDecisionRace", "SELLER", false, true);
    const contradictoryTax = await recordCurrentTaxLocalValidation({ sellerId: contradictoryTaxSeller.sellerProfile!.id, expectedOnboardingVersion: 0, identifierType: "TCKN", idempotencyKey: `slice-e-tax-decision-${key()}` }, prisma);
    const taxDecisions = await Promise.allSettled([
      reviewTaxVerification({ authenticatedUserId: reviewerA.id }, taxInput(contradictoryTax, "APPROVE"), prisma),
      reviewTaxVerification({ authenticatedUserId: reviewerB.id }, taxInput(contradictoryTax, "REJECT"), prisma),
    ]);
    assert.equal(taxDecisions.filter((result) => result.status === "fulfilled").length, 1, "contradictory tax decisions did not have one winner");
    const taxDecisionLoser = taxDecisions.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert(taxDecisionLoser?.reason instanceof FinancialReviewError && ["INVALID_STATE", "STALE_CONTEXT"].includes(taxDecisionLoser.reason.code), `unexpected tax decision loser: ${String(taxDecisionLoser?.reason)}`);

    const bank = await setCurrentBankDestination({ sellerId: seller.sellerProfile!.id, iban: ibanA, beneficiaryName: "Slice E Seller", expectedCoordinationVersion: 0, idempotencyKey: `slice-e-bank-${key()}` }, prisma);
    await assert.rejects(reviewBankDestination({ authenticatedUserId: reviewerA.id }, { ...bankInput(bank.revision, 1, "APPROVE"), evidenceReference: "" }, prisma), (e: unknown) => e instanceof FinancialReviewError && e.code === "INVALID_INPUT");
    const bankApproved = await reviewBankDestination({ authenticatedUserId: reviewerA.id }, bankInput(bank.revision, 1, "APPROVE"), prisma);
    assert.equal(bankApproved.target.verificationStatus, "VERIFIED");
    assert.equal(bankApproved.target.verificationSource, "MANUAL");
    assert.equal(bankApproved.target.verificationAssurance, "DOCUMENT_REVIEWED");
    assert.equal(bankApproved.evidence.reviewerUserId, reviewerA.id);
    assert.equal(bankApproved.identity.holdActive, true, "single bank approval released financial hold");

    const bankRaceSeller = await createUser("BankRace", "SELLER", false, true);
    const bankRace = await setCurrentBankDestination({ sellerId: bankRaceSeller.sellerProfile!.id, iban: ibanA, beneficiaryName: "Bank Race", expectedCoordinationVersion: 0, idempotencyKey: `slice-e-bank-race-${key()}` }, prisma);
    const bankRaceResults = await Promise.allSettled([
      reviewBankDestination({ authenticatedUserId: reviewerA.id }, bankInput(bankRace.revision, 1, "APPROVE"), prisma),
      setCurrentBankDestination({ sellerId: bankRaceSeller.sellerProfile!.id, iban: ibanB, beneficiaryName: "Bank Race Changed", expectedCoordinationVersion: 1, idempotencyKey: `slice-e-bank-change-${key()}` }, prisma),
    ]);
    assert(bankRaceResults.some((result) => result.status === "fulfilled"));
    const currentBankIdentity = await prisma.sellerFinancialIdentity.findUniqueOrThrow({ where: { id: bankRace.identity.id }, include: { currentBankDestinationRevision: true } });
    assert.equal(currentBankIdentity.currentBankDestinationRevision?.canonicalIban, ibanB);
    assert.equal(currentBankIdentity.currentBankDestinationRevision?.verificationStatus, "UNVERIFIED");
    assert.equal(currentBankIdentity.currentBankDestinationRevision?.verificationAssurance, "LOCAL_CHECKS_ONLY");
    assert.equal(currentBankIdentity.holdActive, true);

    const bankDecisionSeller = await createUser("BankDecisionRace", "SELLER", false, true);
    const bankDecision = await setCurrentBankDestination({ sellerId: bankDecisionSeller.sellerProfile!.id, iban: ibanA, beneficiaryName: "Bank Decision", expectedCoordinationVersion: 0, idempotencyKey: `slice-e-bank-decision-${key()}` }, prisma);
    const bankDecisions = await Promise.allSettled([
      reviewBankDestination({ authenticatedUserId: reviewerA.id }, bankInput(bankDecision.revision, 1, "APPROVE"), prisma),
      reviewBankDestination({ authenticatedUserId: reviewerB.id }, bankInput(bankDecision.revision, 1, "REJECT"), prisma),
    ]);
    assert.equal(bankDecisions.filter((result) => result.status === "fulfilled").length, 1, "contradictory bank decisions did not have one winner");
    const bankDecisionLoser = bankDecisions.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert(bankDecisionLoser?.reason instanceof FinancialReviewError && ["INVALID_STATE", "STALE_CONTEXT"].includes(bankDecisionLoser.reason.code), `unexpected bank decision loser: ${String(bankDecisionLoser?.reason)}`);

    const foreignEvidence = () => prisma.financialVerificationEvidence.create({ data: { sellerId: staleSeller.sellerProfile!.id, taxVerificationId: tax.id, verificationSource: "MANUAL", verificationAssurance: "DOCUMENT_REVIEWED", normalizedFingerprint: tax.normalizedFingerprint, identityVersion: tax.onboardingVersion, reviewerUserId: reviewerA.id, evidenceReference: "vault://forged", reasonCode: "MANUAL_APPROVE:FORGED", requestIdempotencyKey: `slice-e-forged-${key()}` } });
    await assert.rejects(foreignEvidence, (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError);
    const beforeEvidence = await prisma.financialVerificationEvidence.findUniqueOrThrow({ where: { id: approved.evidence.id } });
    const afterEvidence = await prisma.financialVerificationEvidence.findUniqueOrThrow({ where: { id: approved.evidence.id } });
    assert.deepEqual(afterEvidence, beforeEvidence, "manual evidence mutated after creation");
    assert.equal(await prisma.sellerPayout.count({ where: { sellerId: { in: ids.sellers } } }), 0, "manual review changed payout state");
    assert.equal(await prisma.financialLedgerEntry.count({ where: { sellerId: { in: ids.sellers } } }), 0, "manual review changed ledger state");
    assert.equal(await prisma.sellerFinancialIdentity.count({ where: { sellerId: { in: ids.sellers }, holdActive: false } }), 0, "manual review released aggregate hold");
    console.log("PASS: #20 Slice E TEST DB authorization, evidence, stale binding and contradictory decision races");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

void main();
