import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { BankDestinationError, buildBankDestinationContext } from "./bank-destination-domain";
export { BankDestinationError, buildBankDestinationContext, evaluateCurrentBankDestination, normalizeBeneficiaryName } from "./bank-destination-domain";

const HOLD_REASON = "BANK_VERIFICATION_REQUIRED";
const EVIDENCE_SUFFIX = ":bank";
type TransactionHost = Pick<PrismaClient, "$transaction">;
type BankDestinationInput = {
  sellerId: string;
  iban: unknown;
  beneficiaryName: unknown;
  expectedCoordinationVersion: number;
  idempotencyKey: string;
};

function isSerializationFailure(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" || (error.code === "P2010" && JSON.stringify(error.meta ?? {}).includes("40001"));
}

async function runCommand(input: BankDestinationInput, client: TransactionHost) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${input.sellerId} FOR UPDATE`;
    const seller = await tx.sellerProfile.findUnique({ where: { id: input.sellerId }, select: { id: true } });
    if (!seller) throw new BankDestinationError("NOT_FOUND", "Finansal kimlik bulunamadı.");

    let identity = await tx.sellerFinancialIdentity.findUnique({ where: { sellerId: input.sellerId }, include: { currentBankDestinationRevision: true } });
    if (!identity) {
      await tx.sellerFinancialIdentity.create({ data: { sellerId: input.sellerId } });
      identity = await tx.sellerFinancialIdentity.findUniqueOrThrow({ where: { sellerId: input.sellerId }, include: { currentBankDestinationRevision: true } });
    }
    await tx.$queryRaw`SELECT "id" FROM "SellerFinancialIdentity" WHERE "id" = ${identity.id} FOR UPDATE`;
    identity = await tx.sellerFinancialIdentity.findUniqueOrThrow({ where: { id: identity.id }, include: { currentBankDestinationRevision: true } });
    const context = buildBankDestinationContext({ financialIdentityId: identity.id, iban: input.iban, beneficiaryName: input.beneficiaryName });

    const replay = await tx.financialVerificationEvidence.findUnique({
      where: { requestIdempotencyKey: `${input.idempotencyKey}${EVIDENCE_SUFFIX}` },
      include: { bankDestinationRevision: true },
    });
    if (replay) {
      const revision = replay.bankDestinationRevision;
      if (replay.sellerId !== input.sellerId || replay.financialIdentityId !== identity.id || !revision || revision.normalizedFingerprint !== context.normalizedFingerprint) {
        throw new BankDestinationError("IDEMPOTENCY_CONFLICT", "Idempotency anahtarı başka bir banka hedefi bağlamına ait.");
      }
      return { identity, revision, replay: true, changed: false };
    }

    if (identity.coordinationVersion !== input.expectedCoordinationVersion) {
      throw new BankDestinationError("STALE_CONTEXT", "Finansal kimlik değişti; güncel bağlamla yeniden deneyin.");
    }

    const current = identity.currentBankDestinationRevision;
    if (current?.normalizedFingerprint === context.normalizedFingerprint) {
      await tx.financialVerificationEvidence.create({
        data: {
          sellerId: input.sellerId,
          financialIdentityId: identity.id,
          bankDestinationRevisionId: current.id,
          verificationSource: "LOCAL",
          verificationAssurance: "LOCAL_CHECKS_ONLY",
          normalizedFingerprint: current.normalizedFingerprint,
          identityVersion: current.destinationVersion,
          reasonCode: "BANK_DESTINATION_LOCAL_VALIDATION_PASSED",
          requestIdempotencyKey: `${input.idempotencyKey}${EVIDENCE_SUFFIX}`,
        },
      });
      return { identity, revision: current, replay: false, changed: false };
    }

    const revision = await tx.bankDestinationRevision.create({
      data: {
        financialIdentityId: identity.id,
        destinationVersion: (current?.destinationVersion ?? 0) + 1,
        canonicalIban: context.canonicalIban,
        beneficiaryName: context.beneficiaryName,
        normalizedFingerprint: context.normalizedFingerprint,
        verificationStatus: "UNVERIFIED",
        verificationSource: "LOCAL",
        verificationAssurance: "LOCAL_CHECKS_ONLY",
      },
    });
    await tx.financialVerificationEvidence.create({
      data: {
        sellerId: input.sellerId,
        financialIdentityId: identity.id,
        bankDestinationRevisionId: revision.id,
        verificationSource: "LOCAL",
        verificationAssurance: "LOCAL_CHECKS_ONLY",
        normalizedFingerprint: revision.normalizedFingerprint,
        identityVersion: revision.destinationVersion,
        reasonCode: "BANK_DESTINATION_LOCAL_VALIDATION_PASSED",
        requestIdempotencyKey: `${input.idempotencyKey}${EVIDENCE_SUFFIX}`,
      },
    });
    const moved = await tx.sellerFinancialIdentity.updateMany({
      where: { id: identity.id, sellerId: input.sellerId, coordinationVersion: input.expectedCoordinationVersion, currentBankDestinationRevisionId: current?.id ?? null },
      data: {
        currentBankDestinationRevisionId: revision.id,
        coordinationVersion: { increment: 1 },
        holdActive: true,
        holdReasonCode: HOLD_REASON,
        holdSetAt: new Date(),
        holdReleasedAt: null,
      },
    });
    if (moved.count !== 1) throw new BankDestinationError("STALE_CONTEXT", "Finansal kimlik eşzamanlı olarak değiştirildi.");
    const updated = await tx.sellerFinancialIdentity.findUniqueOrThrow({ where: { id: identity.id }, include: { currentBankDestinationRevision: true } });
    return { identity: updated, revision, replay: false, changed: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function setCurrentBankDestination(input: BankDestinationInput, client: TransactionHost = prisma) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 186 || !Number.isInteger(input.expectedCoordinationVersion) || input.expectedCoordinationVersion < 0) {
    throw new BankDestinationError("IDEMPOTENCY_CONFLICT", "Banka hedefi komut bağlamı geçersiz.");
  }
  buildBankDestinationContext({ financialIdentityId: "preflight", iban: input.iban, beneficiaryName: input.beneficiaryName });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await runCommand(input, client); }
    catch (error) { if (!isSerializationFailure(error) || attempt === 1) throw error; }
  }
  throw new BankDestinationError("STALE_CONTEXT", "Finansal kimlik eşzamanlı olarak değiştirildi.");
}
