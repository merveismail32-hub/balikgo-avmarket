import "server-only";

import { Prisma, type PaymentStatus, type RewardLifecycleReason } from "@prisma/client";
import { consumeRewardRedemption, releaseRewardRedemption } from "./reward-ledger";

async function reservationForOrder(tx: Prisma.TransactionClient, orderId: string, userId: string) {
  return tx.rewardTransaction.findFirst({ where: { orderId, userId, type: "REDEEM_RESERVED" }, select: { id: true } });
}

export async function transitionOrderRewardForPayment(tx: Prisma.TransactionClient, input: Readonly<{
  orderId: string; userId: string; paymentId: string; eventIdentity: string;
  target: "REDEEMED" | "REDEEM_RELEASED"; lifecycleReason: RewardLifecycleReason;
  effectiveAt?: Date; providerReference?: string;
}>) {
  const reservation = await reservationForOrder(tx, input.orderId, input.userId);
  if (!reservation) return { outcome: "not-applicable" as const };
  const common = { reservationId: reservation.id, userId: input.userId, orderId: input.orderId, idempotencyKey: `reward-payment:v1:${input.target}:${input.eventIdentity}`, lifecycleReason: input.lifecycleReason, effectiveAt: input.effectiveAt ?? new Date(), correlationId: input.paymentId, providerReference: input.providerReference };
  const result = input.target === "REDEEMED" ? await consumeRewardRedemption(tx, common) : await releaseRewardRedemption(tx, common);
  return { outcome: result.replay ? "replay" as const : "transitioned" as const, ...result };
}

export async function reconcileOrderRewardWithPayment(tx: Prisma.TransactionClient, input: Readonly<{ paymentId: string; eventIdentity: string; effectiveAt?: Date }>) {
  const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { id: true, orderId: true, status: true, providerPaymentId: true, order: { select: { userId: true } } } });
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");
  const target = rewardTargetForPaymentStatus(payment.status);
  if (!target) return { outcome: "not-applicable" as const };
  return transitionOrderRewardForPayment(tx, { orderId: payment.orderId, userId: payment.order.userId, paymentId: payment.id, eventIdentity: input.eventIdentity, target: target.target, lifecycleReason: target.reason, effectiveAt: input.effectiveAt, providerReference: payment.providerPaymentId ?? undefined });
}

function rewardTargetForPaymentStatus(status: PaymentStatus): { target: "REDEEMED" | "REDEEM_RELEASED"; reason: RewardLifecycleReason } | null {
  if (["PAID", "REFUND_PENDING", "PARTIAL_REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED"].includes(status)) return { target: "REDEEMED", reason: "RECONCILIATION_SUCCEEDED" };
  if (["FAILED", "EXPIRED", "CANCELLED"].includes(status)) return { target: "REDEEM_RELEASED", reason: "RECONCILIATION_FAILED" };
  return null;
}
