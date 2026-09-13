ALTER TYPE "RewardTransactionType" ADD VALUE 'REDEEM_RESTORED';
ALTER TYPE "RewardTransactionType" ADD VALUE 'EARN_CLAWED_BACK';
ALTER TYPE "RewardReason" ADD VALUE 'REWARD_REDEMPTION_RESTORED';
ALTER TYPE "RewardReason" ADD VALUE 'REWARD_EARN_CLAWBACK';

ALTER TABLE "RewardTransaction"
  ADD COLUMN "refundId" TEXT,
  ADD COLUMN "refundAllocationMinor" INTEGER,
  ADD COLUMN "originalAllocationMinor" INTEGER,
  ADD COLUMN "allocationVersion" VARCHAR(40);

DROP INDEX "RewardTransaction_originalTransactionId_type_key";
CREATE UNIQUE INDEX "RewardTransaction_single_earn_terminal_key" ON "RewardTransaction"("originalTransactionId", "type") WHERE "type" IN ('EARN_AVAILABLE', 'EARN_REVERSED', 'POINTS_EXPIRED');
CREATE UNIQUE INDEX "RewardTransaction_single_redemption_terminal_key" ON "RewardTransaction"("originalTransactionId") WHERE "type" IN ('REDEEMED', 'REDEEM_RELEASED');
CREATE UNIQUE INDEX "RewardTransaction_refundId_type_originalTransactionId_key" ON "RewardTransaction"("refundId", "type", "originalTransactionId");
CREATE INDEX "RewardTransaction_originalTransactionId_type_idx" ON "RewardTransaction"("originalTransactionId", "type");

ALTER TABLE "RewardTransaction" DROP CONSTRAINT "RewardTransaction_points_check";
ALTER TABLE "RewardTransaction" DROP CONSTRAINT "RewardTransaction_origin_check";
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_points_check" CHECK (("type" IN ('PENDING_EARN', 'EARN_AVAILABLE', 'REDEEM_RESERVED', 'REDEEM_RESTORED') AND "points" > 0) OR ("type" IN ('EARN_REVERSED', 'POINTS_EXPIRED', 'REDEEMED', 'REDEEM_RELEASED', 'EARN_CLAWED_BACK') AND "points" < 0));
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_origin_check" CHECK (("type" IN ('PENDING_EARN', 'REDEEM_RESERVED') AND "originalTransactionId" IS NULL) OR ("type" NOT IN ('PENDING_EARN', 'REDEEM_RESERVED') AND "originalTransactionId" IS NOT NULL));
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_refund_provenance_check" CHECK (("type" NOT IN ('REDEEM_RESTORED', 'EARN_CLAWED_BACK') AND "refundId" IS NULL AND "refundAllocationMinor" IS NULL AND "originalAllocationMinor" IS NULL AND "allocationVersion" IS NULL) OR ("type" IN ('REDEEM_RESTORED', 'EARN_CLAWED_BACK') AND "refundId" IS NOT NULL AND "refundAllocationMinor" > 0 AND "originalAllocationMinor" > 0 AND "allocationVersion" = 'PROPORTIONAL_CUMULATIVE_V1'));
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
