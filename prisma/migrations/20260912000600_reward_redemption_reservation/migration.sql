ALTER TYPE "RewardTransactionType" ADD VALUE 'REDEEM_RESERVED';
ALTER TYPE "RewardTransactionType" ADD VALUE 'REDEEMED';
ALTER TYPE "RewardTransactionType" ADD VALUE 'REDEEM_RELEASED';

ALTER TYPE "RewardReason" ADD VALUE 'ORDER_REDEMPTION_RESERVED';
ALTER TYPE "RewardReason" ADD VALUE 'ORDER_REDEMPTION_CONSUMED';
ALTER TYPE "RewardReason" ADD VALUE 'ORDER_REDEMPTION_RELEASED';

ALTER TABLE "RewardPolicy" ADD COLUMN "minimumPayableMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RewardPolicy" ADD CONSTRAINT "RewardPolicy_minimum_payable_check" CHECK ("minimumPayableMinor" >= 0);

ALTER TABLE "RewardTransaction"
  ADD COLUMN "monetaryValueMinor" INTEGER,
  ADD COLUMN "currency" CHAR(3),
  ADD COLUMN "conversionPoints" INTEGER,
  ADD COLUMN "conversionValueMinor" INTEGER,
  ADD COLUMN "roundingRule" VARCHAR(40),
  ADD COLUMN "eligibleAmountMinor" INTEGER,
  ADD COLUMN "requestedPoints" INTEGER,
  ADD COLUMN "useMaximum" BOOLEAN;

ALTER TABLE "RewardTransaction" DROP CONSTRAINT "RewardTransaction_points_check";
ALTER TABLE "RewardTransaction" DROP CONSTRAINT "RewardTransaction_origin_check";
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_points_check" CHECK (
  ("type" IN ('PENDING_EARN', 'EARN_AVAILABLE', 'REDEEM_RESERVED') AND "points" > 0) OR
  ("type" IN ('EARN_REVERSED', 'POINTS_EXPIRED', 'REDEEMED', 'REDEEM_RELEASED') AND "points" < 0)
);
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_origin_check" CHECK (
  ("type" IN ('PENDING_EARN', 'REDEEM_RESERVED') AND "originalTransactionId" IS NULL) OR
  ("type" NOT IN ('PENDING_EARN', 'REDEEM_RESERVED') AND "originalTransactionId" IS NOT NULL)
);
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_redemption_snapshot_check" CHECK (
  ("type" NOT IN ('REDEEM_RESERVED', 'REDEEMED', 'REDEEM_RELEASED')) OR
  ("monetaryValueMinor" IS NOT NULL AND "monetaryValueMinor" > 0 AND "currency" = 'TRY' AND
   "conversionPoints" IS NOT NULL AND "conversionPoints" > 0 AND
   "conversionValueMinor" IS NOT NULL AND "conversionValueMinor" > 0 AND
   "roundingRule" IS NOT NULL AND "eligibleAmountMinor" IS NOT NULL AND "eligibleAmountMinor" > 0)
);
CREATE UNIQUE INDEX "RewardTransaction_one_reservation_per_order_key"
  ON "RewardTransaction"("orderId") WHERE "type" = 'REDEEM_RESERVED';

ALTER TABLE "Order"
  ADD COLUMN "rewardDiscountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "rewardReservationId" TEXT,
  ADD COLUMN "rewardAccountId" TEXT,
  ADD COLUMN "rewardUserId" TEXT,
  ADD COLUMN "rewardPolicyId" TEXT,
  ADD COLUMN "rewardPolicyVersion" INTEGER,
  ADD COLUMN "rewardReservedPoints" INTEGER,
  ADD COLUMN "rewardValueMinor" INTEGER,
  ADD COLUMN "rewardCurrency" CHAR(3),
  ADD COLUMN "rewardRedeemPoints" INTEGER,
  ADD COLUMN "rewardRedeemValueMinor" INTEGER,
  ADD COLUMN "rewardRoundingRule" VARCHAR(40),
  ADD COLUMN "rewardEffectiveAt" TIMESTAMPTZ(3),
  ADD COLUMN "rewardFundingSource" "RewardFundingSource",
  ADD COLUMN "rewardIdempotencyKey" VARCHAR(191),
  ADD COLUMN "rewardUseMaximum" BOOLEAN,
  ADD COLUMN "rewardRequestedPoints" INTEGER;

CREATE UNIQUE INDEX "Order_rewardReservationId_key" ON "Order"("rewardReservationId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_reward_snapshot_check" CHECK (
  ("rewardReservationId" IS NULL AND "rewardDiscountAmount" = 0) OR
  ("rewardReservationId" IS NOT NULL AND "rewardAccountId" IS NOT NULL AND "rewardUserId" = "userId" AND
   "rewardPolicyId" IS NOT NULL AND "rewardPolicyVersion" > 0 AND "rewardReservedPoints" > 0 AND
   "rewardValueMinor" > 0 AND "rewardCurrency" = 'TRY' AND "rewardRedeemPoints" > 0 AND
   "rewardRedeemValueMinor" > 0 AND "rewardRoundingRule" IS NOT NULL AND "rewardEffectiveAt" IS NOT NULL AND
   "rewardFundingSource" = 'PLATFORM' AND "rewardIdempotencyKey" IS NOT NULL AND
   (("rewardUseMaximum" = TRUE AND "rewardRequestedPoints" IS NULL) OR
    ("rewardUseMaximum" = FALSE AND "rewardRequestedPoints" > 0)) AND
   "rewardDiscountAmount" = ("rewardValueMinor"::numeric / 100))
);
