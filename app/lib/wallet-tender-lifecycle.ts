import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { semanticHash, StoredValueDomainError } from "./stored-value-domain";

type Tx = Prisma.TransactionClient;

async function lockPayment(tx: Tx, paymentId: string) {
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
}

export async function finalizeWalletTender(tx: Tx, input: Readonly<{ paymentId: string; target: "CAPTURED" | "RELEASED"; idempotencyKey: string; effectiveAt: Date; providerReference?: string }>) {
  const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { id: true, orderId: true, order: { select: { userId: true } }, walletTenderAllocation: true } });
  if (!payment?.walletTenderAllocation) return { outcome: "not-applicable" as const };
  await lockPayment(tx, input.paymentId);
  const allocation = await tx.walletTenderAllocation.findUniqueOrThrow({ where: { paymentId: input.paymentId } });
  const key = input.idempotencyKey.trim();
  const hash = semanticHash({ paymentId: payment.id, orderId: payment.orderId, target: input.target, amount: allocation.walletTenderAmount.toFixed(2), currency: allocation.currency, providerReference: input.providerReference ?? null });
  const prior = await tx.walletTransaction.findUnique({ where: { idempotencyKey: key } });
  if (prior) {
    if (prior.semanticHash !== hash || prior.paymentId !== payment.id || prior.type !== (input.target === "CAPTURED" ? "DEBIT_CAPTURED" : "DEBIT_RELEASED")) throw new StoredValueDomainError("STORED_VALUE_IDEMPOTENCY_CONFLICT");
    return { outcome: "replay" as const, transaction: prior };
  }
  if (allocation.lifecycleStatus !== "RESERVED") {
    if ((allocation.lifecycleStatus === "CAPTURED" && input.target === "CAPTURED") || (allocation.lifecycleStatus === "RELEASED" && input.target === "RELEASED")) throw new StoredValueDomainError("STORED_VALUE_IDEMPOTENCY_CONFLICT");
    throw new StoredValueDomainError("STORED_VALUE_LIFECYCLE_CONFLICT");
  }
  if (!allocation.walletAccountId || !allocation.walletReservationId || allocation.walletTenderAmount.lte(0)) return { outcome: "not-applicable" as const };
  await tx.$queryRaw`SELECT id FROM "WalletAccount" WHERE id = ${allocation.walletAccountId} FOR UPDATE`;
  const account = await tx.walletAccount.findUniqueOrThrow({ where: { id: allocation.walletAccountId } });
  const reservation = await tx.walletTransaction.findUniqueOrThrow({ where: { id: allocation.walletReservationId } });
  if (reservation.type !== "DEBIT_RESERVED" || reservation.paymentId !== payment.id || reservation.orderId !== payment.orderId || reservation.userId !== payment.order.userId || reservation.currency !== allocation.currency || !reservation.amount.equals(allocation.walletTenderAmount) || reservation.walletAccountId !== account.id) throw new StoredValueDomainError("STORED_VALUE_PROVENANCE_MISMATCH");
  const afterReserved = account.reservedBalance.minus(reservation.amount);
  if (afterReserved.lt(0)) throw new StoredValueDomainError("WALLET_STATE_CHANGED");
  const changed = await tx.walletAccount.updateMany({ where: { id: account.id, version: account.version, reservedBalance: { gte: reservation.amount } }, data: input.target === "CAPTURED" ? { reservedBalance: afterReserved, version: { increment: 1 } } : { availableBalance: { increment: reservation.amount }, reservedBalance: afterReserved, version: { increment: 1 } } });
  if (changed.count !== 1) throw new StoredValueDomainError("WALLET_STATE_CHANGED");
  const type = input.target === "CAPTURED" ? "DEBIT_CAPTURED" : "DEBIT_RELEASED";
  const transaction = await tx.walletTransaction.create({ data: { walletAccountId: account.id, userId: reservation.userId, amount: reservation.amount, currency: reservation.currency, type, fundingSource: reservation.fundingSource, sourceType: "ORDER_CHECKOUT", sourceReference: reservation.sourceReference, orderId: reservation.orderId, paymentId: reservation.paymentId, availableBalanceBefore: account.availableBalance, availableBalanceAfter: input.target === "CAPTURED" ? account.availableBalance : account.availableBalance.add(reservation.amount), reservedBalanceBefore: account.reservedBalance, reservedBalanceAfter: afterReserved, accountVersionBefore: account.version, accountVersionAfter: account.version + 1, idempotencyKey: key, semanticHash: hash, correlationId: input.providerReference, reason: input.target === "CAPTURED" ? "WALLET_CHECKOUT_CAPTURED" : "WALLET_CHECKOUT_RELEASED", effectiveAt: input.effectiveAt } });
  await tx.walletTenderAllocation.update({ where: { id: allocation.id }, data: input.target === "CAPTURED" ? { lifecycleStatus: "CAPTURED", capturedTransactionId: transaction.id, capturedAt: input.effectiveAt, lifecycleIdempotencyKey: key } : { lifecycleStatus: "RELEASED", releasedTransactionId: transaction.id, releasedAt: input.effectiveAt, lifecycleIdempotencyKey: key } });
  return { outcome: "applied" as const, transaction };
}

export const captureWalletReservation = (tx: Tx, input: Omit<Parameters<typeof finalizeWalletTender>[1], "target">) => finalizeWalletTender(tx, { ...input, target: "CAPTURED" });
export const releaseWalletReservation = (tx: Tx, input: Omit<Parameters<typeof finalizeWalletTender>[1], "target">) => finalizeWalletTender(tx, { ...input, target: "RELEASED" });

export async function finalizeInternalWalletPayment(client: Pick<PrismaClient, "$transaction">, input: Readonly<{ paymentId: string; userId: string; idempotencyKey: string; effectiveAt: Date }>) {
  return client.$transaction(async (tx) => {
    await lockPayment(tx, input.paymentId);
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { id: true, amount: true, currency: true, status: true, orderId: true, order: { select: { userId: true } } } });
    if (!payment || payment.order.userId !== input.userId || !payment.amount.isZero() || payment.currency !== "TRY") throw new StoredValueDomainError("STORED_VALUE_OWNERSHIP_REQUIRED");
    if (payment.status === "PAID") return { replay: true as const };
    if (payment.status !== "PENDING" && payment.status !== "AUTHORIZED") throw new StoredValueDomainError("STORED_VALUE_LIFECYCLE_CONFLICT");
    await captureWalletReservation(tx, { paymentId: payment.id, idempotencyKey: input.idempotencyKey, effectiveAt: input.effectiveAt });
    await tx.payment.update({ where: { id: payment.id, }, data: { status: "PAID", paidAt: input.effectiveAt, provider: "INTERNAL_WALLET" } });
    return { replay: false as const };
  });
}
