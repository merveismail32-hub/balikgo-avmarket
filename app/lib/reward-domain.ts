import "server-only";

export type RewardErrorCode =
  | "REWARD_POLICY_NOT_FOUND" | "REWARD_POLICY_INACTIVE" | "REWARD_POLICY_NOT_EFFECTIVE"
  | "REWARD_ACCOUNT_CONFLICT" | "REWARD_IDEMPOTENCY_CONFLICT" | "REWARD_STALE_STATE"
  | "REWARD_TRANSACTION_INVALID" | "REWARD_REVERSAL_CONFLICT"
  | "REWARD_INSUFFICIENT_POINTS" | "REWARD_NOT_ELIGIBLE" | "REWARD_REDEEM_LIMIT_EXCEEDED"
  | "REWARD_PAYABLE_FLOOR_VIOLATION" | "REWARD_STATE_CHANGED" | "REWARD_TERMINAL_CONFLICT";

export class RewardDomainError extends Error {
  constructor(readonly code: RewardErrorCode) { super(code); }
}

export function assertPositiveInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  return Number(value);
}

export function calculateEarnPoints(input: Readonly<{ eligibleAmountMinor: number; earnAmountMinor: number; earnPoints: number; maxEarnPoints: number | null }>) {
  const eligible = assertPositiveInteger(input.eligibleAmountMinor);
  const unit = assertPositiveInteger(input.earnAmountMinor);
  const pointsPerUnit = assertPositiveInteger(input.earnPoints);
  const calculated = Math.floor(eligible / unit) * pointsPerUnit;
  const capped = input.maxEarnPoints === null ? calculated : Math.min(calculated, assertPositiveInteger(input.maxEarnPoints));
  if (!Number.isSafeInteger(capped) || capped <= 0) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  return capped;
}

export const REWARD_ROUNDING_RULE = "INTEGER_RATIO_FLOOR_V1" as const;

export function calculateRedemption(input: Readonly<{
  availablePoints: number; requestedPoints?: number; useMaximum?: boolean;
  redeemPoints: number; redeemValueMinor: number; maxRedeemPoints: number | null;
  eligibleAmountMinor: number; minimumPayableMinor: number;
}>) {
  if ((input.requestedPoints === undefined) === (input.useMaximum !== true)) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  if (!Number.isSafeInteger(input.availablePoints) || input.availablePoints < 0) throw new RewardDomainError("REWARD_STATE_CHANGED");
  const conversionPoints = assertPositiveInteger(input.redeemPoints);
  const conversionValueMinor = assertPositiveInteger(input.redeemValueMinor);
  const eligibleAmountMinor = assertPositiveInteger(input.eligibleAmountMinor);
  if (!Number.isSafeInteger(input.minimumPayableMinor) || input.minimumPayableMinor < 0) throw new RewardDomainError("REWARD_TRANSACTION_INVALID");
  const monetaryCapacity = eligibleAmountMinor - input.minimumPayableMinor;
  if (monetaryCapacity <= 0) throw new RewardDomainError("REWARD_PAYABLE_FLOOR_VIOLATION");
  const pointCapacity = Math.floor(monetaryCapacity / conversionValueMinor) * conversionPoints;
  const policyCapacity = input.maxRedeemPoints === null ? Number.MAX_SAFE_INTEGER : assertPositiveInteger(input.maxRedeemPoints);
  const capacity = Math.min(input.availablePoints, pointCapacity, policyCapacity);
  const requested = input.useMaximum ? capacity : assertPositiveInteger(input.requestedPoints);
  if (!input.useMaximum && requested > input.availablePoints) throw new RewardDomainError("REWARD_INSUFFICIENT_POINTS");
  if (!input.useMaximum && requested > policyCapacity) throw new RewardDomainError("REWARD_REDEEM_LIMIT_EXCEEDED");
  if (!input.useMaximum && requested > pointCapacity) throw new RewardDomainError("REWARD_PAYABLE_FLOOR_VIOLATION");
  const reservedPoints = Math.floor(requested / conversionPoints) * conversionPoints;
  if (reservedPoints <= 0) throw new RewardDomainError("REWARD_NOT_ELIGIBLE");
  const monetaryValueMinor = Math.floor(reservedPoints / conversionPoints) * conversionValueMinor;
  return { reservedPoints, monetaryValueMinor, conversionPoints, conversionValueMinor, roundingRule: REWARD_ROUNDING_RULE };
}
