import "server-only";

import { Prisma } from "@prisma/client";
import { calculateEarnPoints, calculateRedemption, RewardDomainError } from "./reward-domain";

type Tx = Prisma.TransactionClient;
type Common = Readonly<{ userId: string; orderId: string; idempotencyKey: string; correlationId?: string; effectiveAt: Date; expectedAccountVersion?: number }>;

function validateCommon(input: Common) {
  if (!input.userId || !input.orderId || !input.idempotencyKey.trim() || input.idempotencyKey.length > 191 || !Number.isFinite(input.effectiveAt.getTime())) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
}

async function accountForUpdate(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user || user.role !== "CUSTOMER") throw new RewardDomainError("REWARD_ACCOUNT_CONFLICT");
  const account = await tx.rewardAccount.upsert({ where: { userId }, update: {}, create: { userId } });
  await tx.$queryRaw`SELECT id FROM "RewardAccount" WHERE id = ${account.id} FOR UPDATE`;
  return tx.rewardAccount.findUniqueOrThrow({ where: { id: account.id } });
}

function same(existing: { userId: string; orderId: string; orderItemId: string | null; policyId: string; policyVersion: number; type: string; points: number; originalTransactionId: string | null }, expected: typeof existing) {
  return existing.userId === expected.userId && existing.orderId === expected.orderId && existing.orderItemId === expected.orderItemId && existing.policyId === expected.policyId && existing.policyVersion === expected.policyVersion && existing.type === expected.type && existing.points === expected.points && existing.originalTransactionId === expected.originalTransactionId;
}

function sameRedemption(existing: { userId: string; orderId: string; policyId: string; policyVersion: number; type: string; points: number; requestedPoints: number | null; useMaximum: boolean | null; eligibleAmountMinor: number | null }, expected: typeof existing) {
  return existing.userId === expected.userId && existing.orderId === expected.orderId && existing.policyId === expected.policyId && existing.policyVersion === expected.policyVersion && existing.type === expected.type && existing.points === expected.points && existing.requestedPoints === expected.requestedPoints && existing.useMaximum === expected.useMaximum && existing.eligibleAmountMinor === expected.eligibleAmountMinor;
}

async function replay(tx: Tx, idempotencyKey: string, expected: Parameters<typeof same>[1]) {
  const existing = await tx.rewardTransaction.findUnique({ where: { idempotencyKey } });
  if (!existing) return null;
  if (!same(existing, expected)) throw new RewardDomainError("REWARD_IDEMPOTENCY_CONFLICT");
  return existing;
}

async function changeAvailable(tx: Tx, account: { id: string; version: number }, delta: number, expectedVersion?: number) {
  if (expectedVersion !== undefined && expectedVersion !== account.version) throw new RewardDomainError("REWARD_STALE_STATE");
  const changed = await tx.rewardAccount.updateMany({ where: { id: account.id, version: account.version }, data: { availablePoints: { increment: delta }, version: { increment: 1 } } });
  if (changed.count !== 1) throw new RewardDomainError("REWARD_STALE_STATE");
}

export async function reserveRewardRedemption(tx: Tx, input: Readonly<{
  userId: string; orderId: string; clientRequestId: string; idempotencyKey: string;
  requestedPoints?: number; useMaximum?: boolean; eligibleAmountMinor: number;
  effectiveAt: Date; correlationId?: string; expectedAccountVersion?: number;
}>) {
  validateCommon(input);
  if (!input.clientRequestId || input.clientRequestId.length > 191) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  const account = await accountForUpdate(tx, input.userId);
  const order = await tx.order.findFirst({ where: { id: input.orderId, userId: input.userId, clientRequestId: input.clientRequestId }, select: { id: true } });
  if (!order) throw new RewardDomainError("REWARD_NOT_ELIGIBLE");
  const policy = await tx.rewardPolicy.findFirst({ where: { policyCode: "GLOBAL" }, orderBy: { version: "desc" } });
  if (!policy) throw new RewardDomainError("REWARD_POLICY_NOT_FOUND");
  if (policy.status !== "ACTIVE") throw new RewardDomainError("REWARD_POLICY_INACTIVE");
  if (input.effectiveAt < policy.effectiveFrom || (policy.effectiveUntil && input.effectiveAt >= policy.effectiveUntil)) throw new RewardDomainError("REWARD_POLICY_NOT_EFFECTIVE");
  const calculated = calculateRedemption({ availablePoints: account.availablePoints, requestedPoints: input.requestedPoints, useMaximum: input.useMaximum, redeemPoints: policy.redeemPoints, redeemValueMinor: policy.redeemValueMinor, maxRedeemPoints: policy.maxRedeemPoints, eligibleAmountMinor: input.eligibleAmountMinor, minimumPayableMinor: policy.minimumPayableMinor });
  const semantic = { userId: input.userId, orderId: input.orderId, policyId: policy.id, policyVersion: policy.version, type: "REDEEM_RESERVED", points: calculated.reservedPoints, requestedPoints: input.requestedPoints ?? null, useMaximum: input.useMaximum === true, eligibleAmountMinor: input.eligibleAmountMinor };
  const existing = await tx.rewardTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (!sameRedemption(existing, semantic)) throw new RewardDomainError("REWARD_IDEMPOTENCY_CONFLICT");
    return { transaction: existing, account, replay: true };
  }
  const orderReservation = await tx.rewardTransaction.findFirst({ where: { orderId: input.orderId, type: "REDEEM_RESERVED" } });
  if (orderReservation) throw new RewardDomainError("REWARD_IDEMPOTENCY_CONFLICT");
  if (input.expectedAccountVersion !== undefined && input.expectedAccountVersion !== account.version) throw new RewardDomainError("REWARD_STATE_CHANGED");
  const changed = await tx.rewardAccount.updateMany({ where: { id: account.id, version: account.version, availablePoints: { gte: calculated.reservedPoints } }, data: { availablePoints: { decrement: calculated.reservedPoints }, reservedPoints: { increment: calculated.reservedPoints }, version: { increment: 1 } } });
  if (changed.count !== 1) throw new RewardDomainError("REWARD_STATE_CHANGED");
  const transaction = await tx.rewardTransaction.create({ data: { accountId: account.id, userId: input.userId, orderId: input.orderId, policyId: policy.id, policyVersion: policy.version, type: "REDEEM_RESERVED", reason: "ORDER_REDEMPTION_RESERVED", points: calculated.reservedPoints, monetaryValueMinor: calculated.monetaryValueMinor, currency: "TRY", conversionPoints: calculated.conversionPoints, conversionValueMinor: calculated.conversionValueMinor, roundingRule: calculated.roundingRule, eligibleAmountMinor: input.eligibleAmountMinor, requestedPoints: input.requestedPoints, useMaximum: input.useMaximum === true, effectiveAt: input.effectiveAt, correlationId: input.correlationId ?? input.clientRequestId, idempotencyKey: input.idempotencyKey } });
  return { transaction, account, replay: false };
}

type RewardTerminalInput = Readonly<{
  reservationId: string; userId: string; orderId: string; idempotencyKey: string;
  lifecycleReason: "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED" | "PAYMENT_EXPIRED" | "ORDER_CANCELLED_PRE_PAYMENT" | "RECONCILIATION_SUCCEEDED" | "RECONCILIATION_FAILED";
  effectiveAt: Date; correlationId?: string; providerReference?: string;
}>;

async function transitionRewardRedemption(tx: Tx, input: RewardTerminalInput, target: "REDEEMED" | "REDEEM_RELEASED") {
  validateCommon(input);
  if (!input.reservationId || (input.providerReference?.length ?? 0) > 191) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  const account = await accountForUpdate(tx, input.userId);
  const reservation = await tx.rewardTransaction.findFirst({ where: { id: input.reservationId, accountId: account.id, userId: input.userId, orderId: input.orderId, type: "REDEEM_RESERVED" } });
  if (!reservation) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  const keyed = await tx.rewardTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (keyed) {
    if (keyed.originalTransactionId !== reservation.id || keyed.type !== target || keyed.userId !== input.userId || keyed.orderId !== input.orderId) throw new RewardDomainError("REWARD_IDEMPOTENCY_CONFLICT");
    return { transaction: keyed, replay: true };
  }
  const terminal = await tx.rewardTransaction.findFirst({ where: { originalTransactionId: reservation.id, type: { in: ["REDEEMED", "REDEEM_RELEASED"] } } });
  if (terminal) {
    if (terminal.type !== target) throw new RewardDomainError("REWARD_TERMINAL_CONFLICT");
    return { transaction: terminal, replay: true };
  }
  const data = target === "REDEEMED"
    ? { reservedPoints: { decrement: reservation.points }, version: { increment: 1 } }
    : { availablePoints: { increment: reservation.points }, reservedPoints: { decrement: reservation.points }, version: { increment: 1 } };
  const changed = await tx.rewardAccount.updateMany({ where: { id: account.id, version: account.version, reservedPoints: { gte: reservation.points } }, data });
  if (changed.count !== 1) throw new RewardDomainError("REWARD_STATE_CHANGED");
  const transaction = await tx.rewardTransaction.create({ data: { accountId: reservation.accountId, userId: reservation.userId, orderId: reservation.orderId, policyId: reservation.policyId, policyVersion: reservation.policyVersion, type: target, reason: target === "REDEEMED" ? "ORDER_REDEMPTION_CONSUMED" : "ORDER_REDEMPTION_RELEASED", points: -reservation.points, monetaryValueMinor: reservation.monetaryValueMinor, currency: reservation.currency, conversionPoints: reservation.conversionPoints, conversionValueMinor: reservation.conversionValueMinor, roundingRule: reservation.roundingRule, eligibleAmountMinor: reservation.eligibleAmountMinor, requestedPoints: reservation.requestedPoints, useMaximum: reservation.useMaximum, originalTransactionId: reservation.id, lifecycleReason: input.lifecycleReason, providerReference: input.providerReference, effectiveAt: input.effectiveAt, correlationId: input.correlationId, idempotencyKey: input.idempotencyKey } });
  return { transaction, replay: false };
}

export function consumeRewardRedemption(tx: Tx, input: RewardTerminalInput) {
  if (input.lifecycleReason !== "PAYMENT_SUCCEEDED" && input.lifecycleReason !== "RECONCILIATION_SUCCEEDED") throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  return transitionRewardRedemption(tx, input, "REDEEMED");
}

export function releaseRewardRedemption(tx: Tx, input: RewardTerminalInput) {
  if (input.lifecycleReason !== "PAYMENT_FAILED" && input.lifecycleReason !== "PAYMENT_EXPIRED" && input.lifecycleReason !== "ORDER_CANCELLED_PRE_PAYMENT" && input.lifecycleReason !== "RECONCILIATION_FAILED") throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  return transitionRewardRedemption(tx, input, "REDEEM_RELEASED");
}

export async function createPendingEarn(tx: Tx, input: Common & Readonly<{ orderItemId?: string; eligibleAmountMinor: number; eventAuthority: "PAYMENT_PAID_VERIFIED" }>) {
  validateCommon(input);
  if (input.eventAuthority !== "PAYMENT_PAID_VERIFIED") throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  const account = await accountForUpdate(tx, input.userId);
  const order = await tx.order.findFirst({ where: { id: input.orderId, userId: input.userId, payment: { status: "PAID" } }, select: { id: true } });
  if (!order) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  if (input.orderItemId && !(await tx.orderItem.findFirst({ where: { id: input.orderItemId, orderId: input.orderId }, select: { id: true } }))) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  const policy = await tx.rewardPolicy.findFirst({ where: { policyCode: "GLOBAL" }, orderBy: { version: "desc" } });
  if (!policy) throw new RewardDomainError("REWARD_POLICY_NOT_FOUND");
  if (policy.status !== "ACTIVE") throw new RewardDomainError("REWARD_POLICY_INACTIVE");
  if (input.effectiveAt < policy.effectiveFrom || (policy.effectiveUntil && input.effectiveAt >= policy.effectiveUntil)) throw new RewardDomainError("REWARD_POLICY_NOT_EFFECTIVE");
  const points = calculateEarnPoints({ eligibleAmountMinor: input.eligibleAmountMinor, earnAmountMinor: policy.earnAmountMinor, earnPoints: policy.earnPoints, maxEarnPoints: policy.maxEarnPoints });
  const expected = { userId: input.userId, orderId: input.orderId, orderItemId: input.orderItemId ?? null, policyId: policy.id, policyVersion: policy.version, type: "PENDING_EARN" as const, points, originalTransactionId: null };
  const existing = await replay(tx, input.idempotencyKey, expected); if (existing) return { transaction: existing, replay: true };
  const expiresAt = new Date(input.effectiveAt.getTime() + policy.expiryDays * 86_400_000);
  const transaction = await tx.rewardTransaction.create({ data: { accountId: account.id, ...expected, reason: "ORDER_EARN_PENDING", eligibleAmountMinor: input.eligibleAmountMinor, effectiveAt: input.effectiveAt, expiresAt, correlationId: input.correlationId, idempotencyKey: input.idempotencyKey } });
  return { transaction, replay: false };
}

export async function makeRewardAvailable(tx: Tx, input: Common & Readonly<{ pendingEarnId: string }>) {
  validateCommon(input); const account = await accountForUpdate(tx, input.userId);
  const pending = await tx.rewardTransaction.findFirst({ where: { id: input.pendingEarnId, accountId: account.id, userId: input.userId, orderId: input.orderId, type: "PENDING_EARN" } });
  if (!pending) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  const expected = { userId: pending.userId, orderId: pending.orderId, orderItemId: pending.orderItemId, policyId: pending.policyId, policyVersion: pending.policyVersion, type: "EARN_AVAILABLE" as const, points: pending.points, originalTransactionId: pending.id };
  const existing = await replay(tx, input.idempotencyKey, expected); if (existing) return { transaction: existing, replay: true };
  if (await tx.rewardTransaction.findFirst({ where: { originalTransactionId: pending.id, type: { in: ["EARN_AVAILABLE", "EARN_REVERSED"] } } })) throw new RewardDomainError("REWARD_STALE_STATE");
  await changeAvailable(tx, account, pending.points, input.expectedAccountVersion);
  const transaction = await tx.rewardTransaction.create({ data: { accountId: account.id, ...expected, reason: "ORDER_DELIVERED", eligibleAmountMinor: pending.eligibleAmountMinor, effectiveAt: input.effectiveAt, expiresAt: pending.expiresAt, correlationId: input.correlationId, idempotencyKey: input.idempotencyKey } });
  return { transaction, replay: false };
}

export async function reverseRewardEarn(tx: Tx, input: Common & Readonly<{ pendingEarnId: string; reason: "ORDER_REFUNDED" | "PARTIAL_REFUND" | "PAYMENT_REVERSED" }>) {
  validateCommon(input); const account = await accountForUpdate(tx, input.userId);
  const pending = await tx.rewardTransaction.findFirst({ where: { id: input.pendingEarnId, accountId: account.id, userId: input.userId, orderId: input.orderId, type: "PENDING_EARN" } });
  if (!pending) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  const available = await tx.rewardTransaction.findFirst({ where: { originalTransactionId: pending.id, type: "EARN_AVAILABLE" } });
  const expected = { userId: pending.userId, orderId: pending.orderId, orderItemId: pending.orderItemId, policyId: pending.policyId, policyVersion: pending.policyVersion, type: "EARN_REVERSED" as const, points: -pending.points, originalTransactionId: pending.id };
  const existing = await replay(tx, input.idempotencyKey, expected); if (existing) return { transaction: existing, replay: true };
  if (await tx.rewardTransaction.findFirst({ where: { originalTransactionId: pending.id, type: "EARN_REVERSED" } })) throw new RewardDomainError("REWARD_REVERSAL_CONFLICT");
  if (available && await tx.rewardTransaction.findFirst({ where: { originalTransactionId: available.id, type: "POINTS_EXPIRED" } })) throw new RewardDomainError("REWARD_REVERSAL_CONFLICT");
  if (available) await changeAvailable(tx, account, -pending.points, input.expectedAccountVersion);
  const transaction = await tx.rewardTransaction.create({ data: { accountId: account.id, ...expected, reason: input.reason, effectiveAt: input.effectiveAt, correlationId: input.correlationId, idempotencyKey: input.idempotencyKey } });
  return { transaction, replay: false };
}

export async function expireAvailableReward(tx: Tx, input: Common & Readonly<{ availableTransactionId: string }>) {
  validateCommon(input); const account = await accountForUpdate(tx, input.userId);
  const available = await tx.rewardTransaction.findFirst({ where: { id: input.availableTransactionId, accountId: account.id, userId: input.userId, orderId: input.orderId, type: "EARN_AVAILABLE" } });
  if (!available || !available.expiresAt || input.effectiveAt < available.expiresAt) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  const expected = { userId: available.userId, orderId: available.orderId, orderItemId: available.orderItemId, policyId: available.policyId, policyVersion: available.policyVersion, type: "POINTS_EXPIRED" as const, points: -available.points, originalTransactionId: available.id };
  const existing = await replay(tx, input.idempotencyKey, expected); if (existing) return { transaction: existing, replay: true };
  if (await tx.rewardTransaction.findFirst({ where: { originalTransactionId: available.id, type: "POINTS_EXPIRED" } })) throw new RewardDomainError("REWARD_STALE_STATE");
  if (available.originalTransactionId && await tx.rewardTransaction.findFirst({ where: { originalTransactionId: available.originalTransactionId, type: "EARN_REVERSED" } })) throw new RewardDomainError("REWARD_REVERSAL_CONFLICT");
  if (account.availablePoints < available.points) throw new RewardDomainError("REWARD_ACCOUNT_CONFLICT");
  await changeAvailable(tx, account, -available.points, input.expectedAccountVersion);
  const transaction = await tx.rewardTransaction.create({ data: { accountId: account.id, ...expected, reason: "REWARD_EXPIRED", effectiveAt: input.effectiveAt, correlationId: input.correlationId, idempotencyKey: input.idempotencyKey } });
  return { transaction, replay: false };
}
