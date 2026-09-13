import "server-only";

import { Prisma } from "@prisma/client";
import { RewardDomainError } from "./reward-domain";

export const REWARD_REFUND_ALLOCATION_VERSION = "PROPORTIONAL_CUMULATIVE_V1" as const;

function minor(value: Prisma.Decimal) {
  const result = value.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(result) || result <= 0) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  return result;
}

function proportionalTarget(points: number, cumulativeMinor: number, originalMinor: number) {
  if (!Number.isSafeInteger(points) || points <= 0 || !Number.isSafeInteger(cumulativeMinor) || cumulativeMinor < 0 || !Number.isSafeInteger(originalMinor) || originalMinor <= 0) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  const bounded = Math.min(cumulativeMinor, originalMinor);
  return Number((BigInt(points) * BigInt(bounded)) / BigInt(originalMinor));
}

export async function applyCompletedRefundRewards(tx: Prisma.TransactionClient, input: Readonly<{ refundId: string; effectiveAt?: Date; reconciliation?: boolean }>) {
  const identity = await tx.refund.findUnique({ where: { id: input.refundId }, select: { orderId: true } });
  if (!identity) return { outcome: "not-final" as const, restoredPoints: 0, clawedBackPoints: 0 };
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reward-refund:${identity.orderId}`}, 0))`;
  await tx.$queryRaw`SELECT id FROM "Refund" WHERE id = ${input.refundId} FOR UPDATE`;
  const refund = await tx.refund.findUnique({ where: { id: input.refundId }, include: { order: { select: { id: true, userId: true, items: { select: { id: true, unitPrice: true, quantity: true, discountAmount: true, finalLineAmount: true } } } } } });
  if (!refund || refund.status !== "COMPLETED") return { outcome: "not-final" as const, restoredPoints: 0, clawedBackPoints: 0 };
  const account = await tx.rewardAccount.findUnique({ where: { userId: refund.order.userId } });
  if (!account) return { outcome: "not-applicable" as const, restoredPoints: 0, clawedBackPoints: 0 };
  await tx.$queryRaw`SELECT id FROM "RewardAccount" WHERE id = ${account.id} FOR UPDATE`;
  const locked = await tx.rewardAccount.findUniqueOrThrow({ where: { id: account.id } });
  const itemMinor = new Map(refund.order.items.map(item => [item.id, minor(item.finalLineAmount ?? item.unitPrice.mul(item.quantity).minus(item.discountAmount))]));
  const orderEligibleMinor = [...itemMinor.values()].reduce((sum, value) => sum + value, 0);
  const completedRefunds = await tx.refund.findMany({ where: { orderId: refund.orderId, status: "COMPLETED" }, select: { id: true, orderItemId: true, amount: true } });
  const cumulativeOrderMinor = completedRefunds.reduce((sum, item) => sum + minor(item.amount), 0);
  const currentAllocationMinor = minor(refund.amount);
  const effectiveAt = input.effectiveAt ?? refund.completedAt ?? new Date();
  let restoredPoints = 0, clawedBackPoints = 0;

  const redeemed = await tx.rewardTransaction.findFirst({ where: { orderId: refund.orderId, userId: refund.order.userId, type: "REDEEMED" } });
  if (redeemed) {
    const originalPoints = Math.abs(redeemed.points);
    const target = proportionalTarget(originalPoints, cumulativeOrderMinor, orderEligibleMinor);
    const prior = await tx.rewardTransaction.aggregate({ where: { originalTransactionId: redeemed.id, type: "REDEEM_RESTORED" }, _sum: { points: true } });
    restoredPoints = target - (prior._sum.points ?? 0);
    if (restoredPoints < 0) throw new RewardDomainError("REWARD_TERMINAL_CONFLICT");
    if (restoredPoints > 0) await tx.rewardTransaction.create({ data: { accountId: locked.id, userId: refund.order.userId, orderId: refund.orderId, orderItemId: refund.orderItemId, policyId: redeemed.policyId, policyVersion: redeemed.policyVersion, type: "REDEEM_RESTORED", reason: "REWARD_REDEMPTION_RESTORED", points: restoredPoints, monetaryValueMinor: redeemed.monetaryValueMinor, currency: redeemed.currency, conversionPoints: redeemed.conversionPoints, conversionValueMinor: redeemed.conversionValueMinor, roundingRule: redeemed.roundingRule, eligibleAmountMinor: redeemed.eligibleAmountMinor, originalTransactionId: redeemed.id, refundId: refund.id, refundAllocationMinor: currentAllocationMinor, originalAllocationMinor: orderEligibleMinor, allocationVersion: REWARD_REFUND_ALLOCATION_VERSION, effectiveAt, correlationId: refund.paymentId, idempotencyKey: `reward-refund-restore:v1:${refund.id}:${redeemed.id}`, providerReference: refund.providerRefundId } });
  }

  const availableEarns = await tx.rewardTransaction.findMany({ where: { orderId: refund.orderId, userId: refund.order.userId, type: "EARN_AVAILABLE" } });
  for (const earn of availableEarns) {
    const basisMinor = earn.eligibleAmountMinor ?? (earn.orderItemId ? itemMinor.get(earn.orderItemId) : orderEligibleMinor);
    if (!basisMinor) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
    const cumulativeMinor = earn.orderItemId ? completedRefunds.filter(item => item.orderItemId === earn.orderItemId).reduce((sum, item) => sum + minor(item.amount), 0) : cumulativeOrderMinor;
    const target = proportionalTarget(earn.points, cumulativeMinor, basisMinor);
    const prior = await tx.rewardTransaction.aggregate({ where: { originalTransactionId: earn.id, type: "EARN_CLAWED_BACK" }, _sum: { points: true } });
    const already = Math.abs(prior._sum.points ?? 0), delta = target - already;
    if (delta < 0) throw new RewardDomainError("REWARD_TERMINAL_CONFLICT");
    if (delta > 0) {
      clawedBackPoints += delta;
      await tx.rewardTransaction.create({ data: { accountId: locked.id, userId: refund.order.userId, orderId: refund.orderId, orderItemId: refund.orderItemId, policyId: earn.policyId, policyVersion: earn.policyVersion, type: "EARN_CLAWED_BACK", reason: "REWARD_EARN_CLAWBACK", points: -delta, originalTransactionId: earn.id, refundId: refund.id, refundAllocationMinor: currentAllocationMinor, originalAllocationMinor: basisMinor, allocationVersion: REWARD_REFUND_ALLOCATION_VERSION, effectiveAt, correlationId: refund.paymentId, idempotencyKey: `reward-refund-clawback:v1:${refund.id}:${earn.id}`, providerReference: refund.providerRefundId } });
    }
  }

  const net = restoredPoints - clawedBackPoints;
  if (net !== 0) {
    const changed = await tx.rewardAccount.updateMany({ where: { id: locked.id, version: locked.version }, data: { availablePoints: { increment: net }, version: { increment: 1 } } });
    if (changed.count !== 1) throw new RewardDomainError("REWARD_STATE_CHANGED");
  }
  return { outcome: restoredPoints || clawedBackPoints ? "adjusted" as const : "replay" as const, restoredPoints, clawedBackPoints };
}

export async function reconcileCompletedOrderRefundRewards(tx: Prisma.TransactionClient, orderId: string) {
  const refunds = await tx.refund.findMany({ where: { orderId, status: "COMPLETED" }, select: { id: true }, orderBy: { completedAt: "asc" } });
  for (const refund of refunds) await applyCompletedRefundRewards(tx, { refundId: refund.id, reconciliation: true });
}
