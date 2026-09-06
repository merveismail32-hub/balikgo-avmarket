import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { parseCommissionRate } from "./commission";

export type CommissionAgreementErrorCode =
  | "FORBIDDEN"
  | "SELLER_NOT_FOUND"
  | "CATEGORY_NOT_FOUND"
  | "AGREEMENT_NOT_FOUND"
  | "INVALID_RATE"
  | "INVALID_EFFECTIVE_WINDOW"
  | "INVALID_REASON"
  | "OVERLAPPING_AGREEMENT"
  | "STALE_VERSION"
  | "CONCURRENT_CHANGE";

export class CommissionAgreementError extends Error {
  constructor(readonly code: CommissionAgreementErrorCode) { super(code); }
}

type TransactionHost = Pick<PrismaClient, "$transaction">;
export type CommissionAgreementReadClient = Pick<PrismaClient, "sellerCategoryCommissionAgreement">;
type AgreementCommand = Readonly<{
  actorUserId: string;
  sellerId: string;
  categoryId: string;
  commissionRate: string;
  effectiveFrom: Date;
  effectiveUntil?: Date | null;
  reason: string;
}>;

function commandValues(input: AgreementCommand) {
  let commissionRate: Prisma.Decimal;
  try { commissionRate = parseCommissionRate(input.commissionRate); }
  catch { throw new CommissionAgreementError("INVALID_RATE"); }
  if (Number.isNaN(input.effectiveFrom.getTime()) || (input.effectiveUntil && Number.isNaN(input.effectiveUntil.getTime())) || (input.effectiveUntil && input.effectiveUntil <= input.effectiveFrom)) {
    throw new CommissionAgreementError("INVALID_EFFECTIVE_WINDOW");
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) throw new CommissionAgreementError("INVALID_REASON");
  return { commissionRate, effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil ?? null, reason };
}

function overlapWhere(input: Readonly<{ sellerId: string; categoryId: string; effectiveFrom: Date; effectiveUntil: Date | null; excludeId?: string }>): Prisma.SellerCategoryCommissionAgreementWhereInput {
  return {
    sellerId: input.sellerId,
    categoryId: input.categoryId,
    ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    AND: [
      { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: input.effectiveFrom } }] },
      ...(input.effectiveUntil ? [{ effectiveFrom: { lt: input.effectiveUntil } }] : []),
    ],
  };
}

function isSerializationFailure(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2034" || (error.code === "P2010" && JSON.stringify(error.meta ?? {}).includes("40001")));
}

async function lockAuthority(tx: Prisma.TransactionClient, input: Pick<AgreementCommand, "actorUserId" | "sellerId" | "categoryId">) {
  const actor = await tx.user.findUnique({ where: { id: input.actorUserId }, select: { role: true } });
  if (actor?.role !== "ADMIN") throw new CommissionAgreementError("FORBIDDEN");
  await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${input.sellerId} FOR UPDATE`;
  if (!await tx.sellerProfile.findUnique({ where: { id: input.sellerId }, select: { id: true } })) throw new CommissionAgreementError("SELLER_NOT_FOUND");
  await tx.$queryRaw`SELECT "id" FROM "Category" WHERE "id" = ${input.categoryId} FOR UPDATE`;
  if (!await tx.category.findUnique({ where: { id: input.categoryId }, select: { id: true } })) throw new CommissionAgreementError("CATEGORY_NOT_FOUND");
}

function provenance(agreement: Readonly<{ id: string; version: number; sellerId: string; categoryId: string; commissionRate: Prisma.Decimal; effectiveFrom: Date; effectiveUntil: Date | null }>) {
  return Object.freeze({
    source: "SELLER_CATEGORY_AGREEMENT" as const,
    agreementId: agreement.id,
    agreementVersion: agreement.version,
    sellerId: agreement.sellerId,
    categoryId: agreement.categoryId,
    rate: agreement.commissionRate,
    effectiveFrom: agreement.effectiveFrom,
    effectiveUntil: agreement.effectiveUntil,
  });
}

export async function createSellerCategoryCommissionAgreement(input: AgreementCommand, client: TransactionHost = prisma) {
  const values = commandValues(input);
  try {
    return await client.$transaction(async (tx) => {
      await lockAuthority(tx, input);
      if (await tx.sellerCategoryCommissionAgreement.findFirst({ where: overlapWhere({ ...input, ...values }), select: { id: true } })) throw new CommissionAgreementError("OVERLAPPING_AGREEMENT");
      const agreement = await tx.sellerCategoryCommissionAgreement.create({ data: { sellerId: input.sellerId, categoryId: input.categoryId, commissionRate: values.commissionRate, effectiveFrom: values.effectiveFrom, effectiveUntil: values.effectiveUntil } });
      await tx.adminAuditLog.create({ data: { actorUserId: input.actorUserId, action: "COMMISSION_AGREEMENT_CREATED", entityType: "COMMISSION_AGREEMENT", entityId: agreement.id, toStatus: "VERSION_1", note: values.reason } });
      return provenance(agreement);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isSerializationFailure(error)) throw new CommissionAgreementError("CONCURRENT_CHANGE");
    throw error;
  }
}

export async function updateSellerCategoryCommissionAgreement(input: AgreementCommand & Readonly<{ agreementId: string; expectedVersion: number }>, client: TransactionHost = prisma) {
  const values = commandValues(input);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new CommissionAgreementError("STALE_VERSION");
  try {
    return await client.$transaction(async (tx) => {
      await lockAuthority(tx, input);
      await tx.$queryRaw`SELECT "id" FROM "SellerCategoryCommissionAgreement" WHERE "id" = ${input.agreementId} FOR UPDATE`;
      const current = await tx.sellerCategoryCommissionAgreement.findFirst({ where: { id: input.agreementId, sellerId: input.sellerId, categoryId: input.categoryId } });
      if (!current) throw new CommissionAgreementError("AGREEMENT_NOT_FOUND");
      if (current.version !== input.expectedVersion) throw new CommissionAgreementError("STALE_VERSION");
      if (await tx.sellerCategoryCommissionAgreement.findFirst({ where: overlapWhere({ ...input, ...values, excludeId: current.id }), select: { id: true } })) throw new CommissionAgreementError("OVERLAPPING_AGREEMENT");
      const changed = await tx.sellerCategoryCommissionAgreement.updateMany({ where: { id: current.id, sellerId: input.sellerId, categoryId: input.categoryId, version: input.expectedVersion }, data: { commissionRate: values.commissionRate, effectiveFrom: values.effectiveFrom, effectiveUntil: values.effectiveUntil, version: { increment: 1 } } });
      if (changed.count !== 1) throw new CommissionAgreementError("STALE_VERSION");
      const agreement = await tx.sellerCategoryCommissionAgreement.findUniqueOrThrow({ where: { id: current.id } });
      await tx.adminAuditLog.create({ data: { actorUserId: input.actorUserId, action: "COMMISSION_AGREEMENT_UPDATED", entityType: "COMMISSION_AGREEMENT", entityId: agreement.id, fromStatus: `VERSION_${current.version}`, toStatus: `VERSION_${agreement.version}`, note: values.reason } });
      return provenance(agreement);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isSerializationFailure(error)) throw new CommissionAgreementError("CONCURRENT_CHANGE");
    throw error;
  }
}

export async function getEffectiveSellerCategoryCommissionAgreement(input: Readonly<{ sellerId: string; categoryId: string; at: Date }>, client: CommissionAgreementReadClient = prisma) {
  if (Number.isNaN(input.at.getTime())) throw new CommissionAgreementError("INVALID_EFFECTIVE_WINDOW");
  const agreements = await client.sellerCategoryCommissionAgreement.findMany({
    where: { sellerId: input.sellerId, categoryId: input.categoryId, effectiveFrom: { lte: input.at }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: input.at } }] },
    select: { id: true, version: true, sellerId: true, categoryId: true, commissionRate: true, effectiveFrom: true, effectiveUntil: true },
    orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
    take: 2,
  });
  if (agreements.length > 1) throw new CommissionAgreementError("OVERLAPPING_AGREEMENT");
  return agreements[0] ? provenance(agreements[0]) : null;
}
