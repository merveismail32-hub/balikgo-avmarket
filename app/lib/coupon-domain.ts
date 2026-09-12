import "server-only";

import { z } from "zod";

export type CouponDomainErrorCode =
  | "COUPON_CODE_INVALID"
  | "COUPON_CODE_CONFLICT"
  | "COUPON_INACTIVE"
  | "COUPON_REVOKED"
  | "COUPON_NOT_STARTED"
  | "COUPON_EXPIRED"
  | "COUPON_EXHAUSTED"
  | "COUPON_USER_LIMIT_REACHED"
  | "COUPON_NOT_ELIGIBLE"
  | "COUPON_ALREADY_REDEEMED"
  | "COUPON_IDEMPOTENCY_CONFLICT"
  | "COUPON_STALE_STATE"
  | "COUPON_CAMPAIGN_INVALID"
  | "COUPON_FORBIDDEN";

export class CouponDomainError extends Error {
  constructor(readonly code: CouponDomainErrorCode) { super(code); }
}

const codeSchema = z.string().trim().min(3).max(50).regex(/^[A-Z0-9][A-Z0-9_-]*$/);
const instant = z.iso.datetime({ offset: true });
const optionalLimit = z.number().int().positive().max(2_147_483_647).nullable().optional();
export const createCampaignAccessCouponSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(2).max(160),
  campaignId: z.string().min(1).max(191),
  validFrom: instant.nullable().optional(),
  validUntil: instant.nullable().optional(),
  globalRedemptionLimit: optionalLimit,
  perUserRedemptionLimit: z.number().int().positive().max(2_147_483_647).default(1),
  reason: z.string().trim().min(3).max(500),
}).strict();

export const couponLifecycleMutationSchema = z.object({
  lifecycleStatus: z.enum(["ACTIVE", "REVOKED"]),
  expectedVersion: z.number().int().positive().max(2_147_483_646),
  reason: z.string().trim().min(3).max(500),
}).strict();

export function normalizeCampaignAccessCode(value: unknown) {
  if (typeof value !== "string") throw new CouponDomainError("COUPON_CODE_INVALID");
  const parsed = codeSchema.safeParse(value.trim().toUpperCase());
  if (!parsed.success) throw new CouponDomainError("COUPON_CODE_INVALID");
  return parsed.data;
}

type EligibilityInput = Readonly<{
  accessMode: "LEGACY_INLINE" | "CAMPAIGN_ACCESS";
  lifecycleStatus: "ACTIVE" | "REVOKED";
  active: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  usageLimit: number | null;
  usageCount: number;
}>;

export function assertCampaignAccessCouponAvailable(coupon: EligibilityInput, effectiveAt: Date) {
  if (!Number.isFinite(effectiveAt.getTime()) || coupon.accessMode !== "CAMPAIGN_ACCESS") throw new CouponDomainError("COUPON_NOT_ELIGIBLE");
  if (coupon.lifecycleStatus === "REVOKED") throw new CouponDomainError("COUPON_REVOKED");
  if (!coupon.active) throw new CouponDomainError("COUPON_INACTIVE");
  if (!coupon.validFrom || effectiveAt < coupon.validFrom) throw new CouponDomainError("COUPON_NOT_STARTED");
  if (!coupon.validUntil || effectiveAt >= coupon.validUntil) throw new CouponDomainError("COUPON_EXPIRED");
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) throw new CouponDomainError("COUPON_EXHAUSTED");
}

export type CouponRedemptionFoundation = Readonly<{
  couponId: string;
  userId: string;
  orderId: string;
  idempotencyKey: string;
  state: "RESERVED" | "CONSUMED" | "RELEASED";
  couponVersion: number;
  campaignId: string | null;
}>;

export function assertCouponRedemptionFoundation(input: CouponRedemptionFoundation) {
  if (!input.couponId || !input.userId || !input.orderId || !input.idempotencyKey || input.idempotencyKey.length > 191 || !Number.isInteger(input.couponVersion) || input.couponVersion <= 0) throw new CouponDomainError("COUPON_IDEMPOTENCY_CONFLICT");
  if (!(["RESERVED", "CONSUMED", "RELEASED"] as const).includes(input.state)) throw new CouponDomainError("COUPON_STALE_STATE");
  return input;
}
