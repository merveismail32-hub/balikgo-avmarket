import "server-only";

import { Prisma } from "@prisma/client";
import { semanticHash, StoredValueDomainError } from "./stored-value-domain";

export function allocateWalletRefund(originalWallet: Prisma.Decimal, originalExternal: Prisma.Decimal, cumulativeRefund: Prisma.Decimal) {
  const total = originalWallet.add(originalExternal);
  if (originalWallet.lt(0) || originalExternal.lt(0) || total.lte(0) || cumulativeRefund.lt(0) || cumulativeRefund.gt(total)) throw new StoredValueDomainError("STORED_VALUE_INVALID_AMOUNT");
  if (cumulativeRefund.equals(total)) return { wallet: originalWallet, external: originalExternal };
  const wallet = originalWallet.mul(cumulativeRefund).div(total).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { wallet, external: cumulativeRefund.minus(wallet).toDecimalPlaces(2) };
}

export async function restoreCapturedWalletForRefund(tx: Prisma.TransactionClient, input: Readonly<{ refundId: string; effectiveAt?: Date }>) {
  const refund = await tx.refund.findUnique({ where: { id: input.refundId }, select: { id: true, status: true, amount: true, currency: true, orderId: true, paymentId: true, completedAt: true, order: { select: { userId: true } }, payment: { select: { walletTenderAllocation: true } } } });
  if (!refund || refund.status !== "COMPLETED" || !refund.payment.walletTenderAllocation) return { outcome: "not-applicable" as const, walletDelta: new Prisma.Decimal(0), externalDelta: refund?.amount ?? new Prisma.Decimal(0) };
  const allocation = refund.payment.walletTenderAllocation;
  if (allocation.lifecycleStatus !== "CAPTURED" || !allocation.walletAccountId) throw new StoredValueDomainError("STORED_VALUE_LIFECYCLE_CONFLICT");
  await tx.$queryRaw`SELECT id FROM "WalletTenderAllocation" WHERE id = ${allocation.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "WalletAccount" WHERE id = ${allocation.walletAccountId} FOR UPDATE`;
  const account = await tx.walletAccount.findUniqueOrThrow({ where: { id: allocation.walletAccountId } });
  const completed = await tx.refund.aggregate({ where: { paymentId: refund.paymentId, status: "COMPLETED" }, _sum: { amount: true } });
  const cumulative = completed._sum.amount ?? new Prisma.Decimal(0);
  const priorRows = await tx.walletTransaction.findMany({ where: { refundId: { not: null }, paymentId: refund.paymentId, type: "REFUND_CREDIT" }, select: { amount: true } });
  const targets = allocateWalletRefund(allocation.walletTenderAmount, allocation.externalTenderAmount, cumulative);
  const already = priorRows.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0));
  const delta = targets.wallet.minus(already);
  if (delta.lt(0) || delta.gt(allocation.walletTenderAmount.minus(already))) throw new StoredValueDomainError("STORED_VALUE_LIFECYCLE_CONFLICT");
  const key = `wallet-refund:v1:${refund.id}:${allocation.id}`;
  const hash = semanticHash({ refundId: refund.id, orderId: refund.orderId, paymentId: refund.paymentId, allocationId: allocation.id, amount: refund.amount.toFixed(2), currency: refund.currency, walletDelta: delta.toFixed(2), cumulativeWallet: targets.wallet.toFixed(2) });
  const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (existing.semanticHash !== hash || existing.refundId !== refund.id || existing.paymentId !== refund.paymentId) throw new StoredValueDomainError("STORED_VALUE_IDEMPOTENCY_CONFLICT");
    return { outcome: "replay" as const, walletDelta: delta, externalDelta: refund.amount.minus(delta), transaction: existing };
  }
  if (delta.isZero()) return { outcome: "replay" as const, walletDelta: delta, externalDelta: refund.amount.minus(delta) };
  const transaction = await tx.walletTransaction.create({ data: { walletAccountId: account.id, userId: refund.order.userId, amount: delta, currency: refund.currency, type: "REFUND_CREDIT", fundingSource: "REFUND_RESTORATION", sourceType: "REFUND", sourceReference: `${refund.id}:allocation=${allocation.id}:originalWallet=${allocation.walletTenderAmount.toFixed(2)}:cumulative=${cumulative.toFixed(2)}:walletTarget=${targets.wallet.toFixed(2)}:externalTarget=${targets.external.toFixed(2)}`, orderId: refund.orderId, paymentId: refund.paymentId, refundId: refund.id, availableBalanceBefore: account.availableBalance, availableBalanceAfter: account.availableBalance.add(delta), reservedBalanceBefore: account.reservedBalance, reservedBalanceAfter: account.reservedBalance, accountVersionBefore: account.version, accountVersionAfter: account.version + 1, idempotencyKey: key, semanticHash: hash, correlationId: allocation.id, reason: "CAPTURED_WALLET_REFUND_RESTORATION", effectiveAt: input.effectiveAt ?? refund.completedAt ?? new Date() } });
  const changed = await tx.walletAccount.updateMany({ where: { id: account.id, version: account.version }, data: { availableBalance: { increment: delta }, version: { increment: 1 } } });
  if (changed.count !== 1) throw new StoredValueDomainError("WALLET_STATE_CHANGED");
  return { outcome: "applied" as const, walletDelta: delta, externalDelta: refund.amount.minus(delta), transaction };
}
