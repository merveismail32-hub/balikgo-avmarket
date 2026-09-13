CREATE TYPE "RewardLifecycleReason" AS ENUM (
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'ORDER_CANCELLED_PRE_PAYMENT',
  'RECONCILIATION_SUCCEEDED',
  'RECONCILIATION_FAILED'
);

ALTER TABLE "RewardTransaction"
  ADD COLUMN "lifecycleReason" "RewardLifecycleReason",
  ADD COLUMN "providerReference" VARCHAR(191);

ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_lifecycle_reason_check" CHECK (
  ("type" IN ('REDEEMED', 'REDEEM_RELEASED') AND "lifecycleReason" IS NOT NULL) OR
  ("type" NOT IN ('REDEEMED', 'REDEEM_RELEASED') AND "lifecycleReason" IS NULL)
);
