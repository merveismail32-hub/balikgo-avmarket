-- Replaced by Coupon_usage_limits_check, which supports configurable positive per-user limits.
ALTER TABLE "Coupon" DROP CONSTRAINT IF EXISTS "Coupon_limits_check";
