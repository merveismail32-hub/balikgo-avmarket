import "server-only";

import { Prisma, type PrismaClient, type TaxIdentifierType } from "@prisma/client";
import { prisma } from "./prisma";
import { buildCurrentTaxVerificationContext } from "./tax-verification-domain";
import { bankDestinationFingerprint } from "./financial-identity-validation";
import { assertFinancialReviewTransition, canReviewFinancialIdentity, FinancialReviewError, manualDecisionMarker, validateManualReviewIntent, type FinancialReviewDecision } from "./financial-review-domain";
export { assertFinancialReviewTransition, canReviewFinancialIdentity, FinancialReviewError, validateManualReviewIntent } from "./financial-review-domain";

type TransactionHost = Pick<PrismaClient, "$transaction">;
type ReviewerContext = Readonly<{ authenticatedUserId: string }>;
type CommonIntent = { decision: FinancialReviewDecision; reasonCode: string; evidenceReference: string; idempotencyKey: string };
type TaxReviewInput = CommonIntent & { taxVerificationId: string; expectedOnboardingVersion: number; expectedIdentifierType: TaxIdentifierType; expectedFingerprint: string };
type BankReviewInput = CommonIntent & { bankDestinationRevisionId: string; expectedCoordinationVersion: number; expectedDestinationVersion: number; expectedFingerprint: string };

const EVIDENCE_SUFFIX = ":review";
function isSerializationFailure(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" || (error.code === "P2010" && JSON.stringify(error.meta ?? {}).includes("40001"));
}

async function authorizedReviewer(tx: Prisma.TransactionClient, reviewer: ReviewerContext) {
  const user = await tx.user.findUnique({ where: { id: reviewer.authenticatedUserId }, select: { id: true, role: true, financialIdentityReviewerEnabled: true } });
  if (!user || !canReviewFinancialIdentity(user)) throw new FinancialReviewError("FORBIDDEN", "Finansal inceleme yetkisi gerekli.");
  return user;
}

function replayMatches(replay: { reviewerUserId: string | null; reasonCode: string | null; normalizedFingerprint: string; identityVersion: number }, reviewerId: string, intent: ReturnType<typeof validateManualReviewIntent>, expectedFingerprint: string, expectedVersion: number) {
  return replay.reviewerUserId === reviewerId
    && replay.reasonCode === manualDecisionMarker(intent.decision, intent.reasonCode)
    && replay.normalizedFingerprint === expectedFingerprint
    && replay.identityVersion === expectedVersion;
}

async function runTaxReview(client: TransactionHost, reviewerContext: ReviewerContext, raw: TaxReviewInput) {
  const intent = validateManualReviewIntent(raw);
  return client.$transaction(async (tx) => {
    const reviewer = await authorizedReviewer(tx, reviewerContext);
    const initial = await tx.taxVerification.findUnique({ where: { id: raw.taxVerificationId }, select: { sellerId: true } });
    if (!initial) throw new FinancialReviewError("NOT_FOUND", "Finansal doğrulama bulunamadı.");
    await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${initial.sellerId} FOR UPDATE`;
    const profile = await tx.sellerProfile.findUnique({ where: { id: initial.sellerId }, select: { id: true, userId: true, onboardingVersion: true, taxNumber: true, legalName: true, companyType: true, taxOffice: true } });
    if (!profile) throw new FinancialReviewError("NOT_FOUND", "Finansal doğrulama bulunamadı.");
    if (profile.userId === reviewer.id) throw new FinancialReviewError("FORBIDDEN", "Kendi finansal kimliğinizi inceleyemezsiniz.");
    await tx.$queryRaw`SELECT "id" FROM "TaxVerification" WHERE "id" = ${raw.taxVerificationId} FOR UPDATE`;
    const target = await tx.taxVerification.findUnique({ where: { id: raw.taxVerificationId } });
    if (!target || target.sellerId !== profile.id) throw new FinancialReviewError("NOT_FOUND", "Finansal doğrulama bulunamadı.");

    const replay = await tx.financialVerificationEvidence.findUnique({ where: { requestIdempotencyKey: `${intent.idempotencyKey}${EVIDENCE_SUFFIX}` } });
    if (replay) {
      if (replay.taxVerificationId !== target.id || !replayMatches(replay, reviewer.id, intent, raw.expectedFingerprint, raw.expectedOnboardingVersion)) throw new FinancialReviewError("IDEMPOTENCY_CONFLICT", "Idempotency anahtarı başka bir inceleme bağlamına ait.");
      return { target, evidence: replay, replay: true };
    }

    if (profile.onboardingVersion !== raw.expectedOnboardingVersion || target.identifierType !== raw.expectedIdentifierType) throw new FinancialReviewError("STALE_CONTEXT", "Vergi kimliği inceleme bağlamı değişti.");
    const current = buildCurrentTaxVerificationContext(profile, raw.expectedIdentifierType);
    if (current.normalizedFingerprint !== raw.expectedFingerprint || target.normalizedFingerprint !== current.normalizedFingerprint || target.onboardingVersion !== current.onboardingVersion) throw new FinancialReviewError("STALE_CONTEXT", "Vergi kimliği inceleme bağlamı değişti.");
    const nextStatus = assertFinancialReviewTransition(target.verificationStatus, intent.decision);
    const changed = await tx.taxVerification.updateMany({
      where: { id: target.id, sellerId: profile.id, onboardingVersion: current.onboardingVersion, normalizedFingerprint: current.normalizedFingerprint, identifierType: current.identifierType, verificationStatus: target.verificationStatus },
      data: { verificationStatus: nextStatus, verificationSource: "MANUAL", verificationAssurance: "DOCUMENT_REVIEWED", reviewerUserId: reviewer.id, reasonCode: intent.reasonCode, decidedAt: new Date() },
    });
    if (changed.count !== 1) throw new FinancialReviewError("STALE_CONTEXT", "Vergi doğrulama kararı eşzamanlı olarak değiştirildi.");
    const evidence = await tx.financialVerificationEvidence.create({ data: {
      sellerId: profile.id, taxVerificationId: target.id, verificationSource: "MANUAL", verificationAssurance: "DOCUMENT_REVIEWED",
      normalizedFingerprint: current.normalizedFingerprint, identityVersion: current.onboardingVersion, reviewerUserId: reviewer.id,
      evidenceReference: intent.evidenceReference, reasonCode: manualDecisionMarker(intent.decision, intent.reasonCode), requestIdempotencyKey: `${intent.idempotencyKey}${EVIDENCE_SUFFIX}`, decidedAt: new Date(),
    } });
    return { target: await tx.taxVerification.findUniqueOrThrow({ where: { id: target.id } }), evidence, replay: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function runBankReview(client: TransactionHost, reviewerContext: ReviewerContext, raw: BankReviewInput) {
  const intent = validateManualReviewIntent(raw);
  return client.$transaction(async (tx) => {
    const reviewer = await authorizedReviewer(tx, reviewerContext);
    const initial = await tx.bankDestinationRevision.findUnique({ where: { id: raw.bankDestinationRevisionId }, select: { financialIdentity: { select: { id: true, sellerId: true } } } });
    if (!initial) throw new FinancialReviewError("NOT_FOUND", "Banka hedefi bulunamadı.");
    await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${initial.financialIdentity.sellerId} FOR UPDATE`;
    const seller = await tx.sellerProfile.findUnique({ where: { id: initial.financialIdentity.sellerId }, select: { id: true, userId: true } });
    if (!seller) throw new FinancialReviewError("NOT_FOUND", "Banka hedefi bulunamadı.");
    if (seller.userId === reviewer.id) throw new FinancialReviewError("FORBIDDEN", "Kendi finansal kimliğinizi inceleyemezsiniz.");
    await tx.$queryRaw`SELECT "id" FROM "SellerFinancialIdentity" WHERE "id" = ${initial.financialIdentity.id} FOR UPDATE`;
    const identity = await tx.sellerFinancialIdentity.findUnique({ where: { id: initial.financialIdentity.id } });
    if (!identity || identity.sellerId !== seller.id) throw new FinancialReviewError("NOT_FOUND", "Banka hedefi bulunamadı.");
    await tx.$queryRaw`SELECT "id" FROM "BankDestinationRevision" WHERE "id" = ${raw.bankDestinationRevisionId} FOR UPDATE`;
    const target = await tx.bankDestinationRevision.findUnique({ where: { id: raw.bankDestinationRevisionId } });
    if (!target || target.financialIdentityId !== identity.id) throw new FinancialReviewError("NOT_FOUND", "Banka hedefi bulunamadı.");

    const replay = await tx.financialVerificationEvidence.findUnique({ where: { requestIdempotencyKey: `${intent.idempotencyKey}${EVIDENCE_SUFFIX}` } });
    if (replay) {
      if (replay.bankDestinationRevisionId !== target.id || !replayMatches(replay, reviewer.id, intent, raw.expectedFingerprint, raw.expectedDestinationVersion)) throw new FinancialReviewError("IDEMPOTENCY_CONFLICT", "Idempotency anahtarı başka bir inceleme bağlamına ait.");
      return { target, evidence: replay, identity, replay: true };
    }

    const fingerprint = bankDestinationFingerprint({ financialIdentityId: identity.id, canonicalIban: target.canonicalIban, beneficiaryName: target.beneficiaryName });
    if (identity.coordinationVersion !== raw.expectedCoordinationVersion || identity.currentBankDestinationRevisionId !== target.id || target.destinationVersion !== raw.expectedDestinationVersion || target.normalizedFingerprint !== raw.expectedFingerprint || fingerprint !== target.normalizedFingerprint) throw new FinancialReviewError("STALE_CONTEXT", "Banka hedefi inceleme bağlamı değişti.");
    const nextStatus = assertFinancialReviewTransition(target.verificationStatus, intent.decision);
    const changed = await tx.bankDestinationRevision.updateMany({
      where: { id: target.id, financialIdentityId: identity.id, destinationVersion: raw.expectedDestinationVersion, normalizedFingerprint: raw.expectedFingerprint, verificationStatus: target.verificationStatus },
      data: { verificationStatus: nextStatus, verificationSource: "MANUAL", verificationAssurance: "DOCUMENT_REVIEWED", decidedAt: new Date() },
    });
    if (changed.count !== 1) throw new FinancialReviewError("STALE_CONTEXT", "Banka hedefi kararı eşzamanlı olarak değiştirildi.");
    const evidence = await tx.financialVerificationEvidence.create({ data: {
      sellerId: seller.id, financialIdentityId: identity.id, bankDestinationRevisionId: target.id, verificationSource: "MANUAL", verificationAssurance: "DOCUMENT_REVIEWED",
      normalizedFingerprint: target.normalizedFingerprint, identityVersion: target.destinationVersion, reviewerUserId: reviewer.id,
      evidenceReference: intent.evidenceReference, reasonCode: manualDecisionMarker(intent.decision, intent.reasonCode), requestIdempotencyKey: `${intent.idempotencyKey}${EVIDENCE_SUFFIX}`, decidedAt: new Date(),
    } });
    return { target: await tx.bankDestinationRevision.findUniqueOrThrow({ where: { id: target.id } }), evidence, identity: await tx.sellerFinancialIdentity.findUniqueOrThrow({ where: { id: identity.id } }), replay: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function withSerializationRetry<T>(action: () => Promise<T>) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await action(); }
    catch (error) { if (!isSerializationFailure(error) || attempt === 1) throw error; }
  }
  throw new FinancialReviewError("STALE_CONTEXT", "Finansal inceleme bağlamı eşzamanlı olarak değiştirildi.");
}

export function reviewTaxVerification(reviewer: ReviewerContext, input: TaxReviewInput, client: TransactionHost = prisma) {
  return withSerializationRetry(() => runTaxReview(client, reviewer, input));
}

export function reviewBankDestination(reviewer: ReviewerContext, input: BankReviewInput, client: TransactionHost = prisma) {
  return withSerializationRetry(() => runBankReview(client, reviewer, input));
}
