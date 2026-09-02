import "server-only";

import { Prisma, type PrismaClient, type TaxIdentifierType, type TaxVerification } from "@prisma/client";
import { prisma } from "./prisma";
import { buildCurrentTaxVerificationContext, taxProfileContextSelect, TaxVerificationError } from "./tax-verification-domain";
export { buildCurrentTaxVerificationContext, evaluateTaxVerificationApplicability, TaxVerificationError } from "./tax-verification-domain";

type TransactionHost = Pick<PrismaClient, "$transaction">;
type RecordLocalTaxValidationInput = {
  sellerId: string;
  expectedOnboardingVersion: number;
  identifierType: TaxIdentifierType;
  idempotencyKey: string;
};

function assertReplayMatches(replay: Pick<TaxVerification, "sellerId" | "onboardingVersion" | "identifierType">, input: RecordLocalTaxValidationInput) {
  if (replay.sellerId !== input.sellerId || replay.onboardingVersion !== input.expectedOnboardingVersion || replay.identifierType !== input.identifierType) {
    throw new TaxVerificationError("IDEMPOTENCY_CONFLICT", "Idempotency anahtarı başka bir vergi doğrulama bağlamına ait.");
  }
}

export async function recordCurrentTaxLocalValidation(input: RecordLocalTaxValidationInput, client: TransactionHost = prisma) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 182) throw new TaxVerificationError("IDEMPOTENCY_CONFLICT", "Idempotency anahtarı geçersiz.");
  return client.$transaction(async (tx) => {
    const replay = await tx.taxVerification.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) {
      assertReplayMatches(replay, input);
      return replay;
    }

    await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${input.sellerId} FOR UPDATE`;
    const profile = await tx.sellerProfile.findUnique({ where: { id: input.sellerId }, select: taxProfileContextSelect });
    if (!profile) throw new TaxVerificationError("NOT_FOUND", "Satıcı profili bulunamadı.");
    if (profile.onboardingVersion !== input.expectedOnboardingVersion) {
      throw new TaxVerificationError("STALE_CONTEXT", "Satıcı vergi profili değişti; güncel bağlamla yeniden deneyin.");
    }
    const context = buildCurrentTaxVerificationContext(profile, input.identifierType);
    const existing = await tx.taxVerification.findUnique({
      where: { sellerId_onboardingVersion_normalizedFingerprint: { sellerId: context.sellerId, onboardingVersion: context.onboardingVersion, normalizedFingerprint: context.normalizedFingerprint } },
    });
    if (existing) return existing;

    const reasonCode = context.localValidation.validationLevel === "CHECKSUM" ? "LOCAL_CHECKSUM_VALIDATION_PASSED" : "LOCAL_STRUCTURE_VALIDATION_PASSED";
    const verification = await tx.taxVerification.create({
      data: {
        sellerId: context.sellerId,
        onboardingVersion: context.onboardingVersion,
        identifierType: context.identifierType,
        normalizedFingerprint: context.normalizedFingerprint,
        verificationStatus: "UNVERIFIED",
        verificationSource: "LOCAL",
        verificationAssurance: "LOCAL_CHECKS_ONLY",
        reasonCode,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await tx.financialVerificationEvidence.create({
      data: {
        sellerId: context.sellerId,
        taxVerificationId: verification.id,
        verificationSource: "LOCAL",
        verificationAssurance: "LOCAL_CHECKS_ONLY",
        normalizedFingerprint: context.normalizedFingerprint,
        identityVersion: context.onboardingVersion,
        reasonCode,
        requestIdempotencyKey: `${input.idempotencyKey}:evidence`,
      },
    });
    return verification;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
