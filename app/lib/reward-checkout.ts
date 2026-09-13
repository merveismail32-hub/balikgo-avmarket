import "server-only";

import { Prisma } from "@prisma/client";
import { reserveRewardRedemption } from "./reward-ledger";

export async function reserveRewardForCheckout(tx: Prisma.TransactionClient, input: Readonly<{
  userId: string; orderId: string; clientRequestId: string; eligibleAmount: Prisma.Decimal;
  requestedPoints?: number; useMaximum?: boolean; effectiveAt: Date;
}>) {
  const eligibleAmountMinor = input.eligibleAmount.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  const reservation = await reserveRewardRedemption(tx, { userId: input.userId, orderId: input.orderId, clientRequestId: input.clientRequestId, idempotencyKey: `reward-redemption:v1:${input.clientRequestId}:${input.userId}`, requestedPoints: input.requestedPoints, useMaximum: input.useMaximum, eligibleAmountMinor, effectiveAt: input.effectiveAt, correlationId: input.clientRequestId });
  const rewardDiscountAmount = new Prisma.Decimal(reservation.transaction.monetaryValueMinor!).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const totalAmount = input.eligibleAmount.minus(rewardDiscountAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  await tx.order.update({ where: { id: input.orderId }, data: { totalAmount, rewardDiscountAmount, rewardReservationId: reservation.transaction.id, rewardAccountId: reservation.transaction.accountId, rewardUserId: reservation.transaction.userId, rewardPolicyId: reservation.transaction.policyId, rewardPolicyVersion: reservation.transaction.policyVersion, rewardReservedPoints: reservation.transaction.points, rewardValueMinor: reservation.transaction.monetaryValueMinor, rewardCurrency: reservation.transaction.currency, rewardRedeemPoints: reservation.transaction.conversionPoints, rewardRedeemValueMinor: reservation.transaction.conversionValueMinor, rewardRoundingRule: reservation.transaction.roundingRule, rewardEffectiveAt: reservation.transaction.effectiveAt, rewardFundingSource: "PLATFORM", rewardIdempotencyKey: reservation.transaction.idempotencyKey } });
  return { ...reservation, rewardDiscountAmount, totalAmount };
}
