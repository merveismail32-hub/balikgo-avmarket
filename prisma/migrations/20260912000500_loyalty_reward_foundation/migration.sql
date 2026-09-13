CREATE TYPE "RewardPolicyStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "RewardFundingSource" AS ENUM ('PLATFORM');
CREATE TYPE "RewardTransactionType" AS ENUM ('PENDING_EARN', 'EARN_AVAILABLE', 'EARN_REVERSED', 'POINTS_EXPIRED');
CREATE TYPE "RewardReason" AS ENUM ('ORDER_EARN_PENDING', 'ORDER_DELIVERED', 'ORDER_REFUNDED', 'PARTIAL_REFUND', 'PAYMENT_REVERSED', 'REWARD_EXPIRED', 'MANUAL_ADJUSTMENT');

CREATE TABLE "RewardPolicy" (
  "id" TEXT NOT NULL,
  "policyCode" VARCHAR(50) NOT NULL DEFAULT 'GLOBAL',
  "version" INTEGER NOT NULL,
  "status" "RewardPolicyStatus" NOT NULL DEFAULT 'INACTIVE',
  "earnAmountMinor" INTEGER NOT NULL,
  "earnPoints" INTEGER NOT NULL,
  "redeemPoints" INTEGER NOT NULL,
  "redeemValueMinor" INTEGER NOT NULL,
  "expiryDays" INTEGER NOT NULL,
  "maxEarnPoints" INTEGER,
  "maxRedeemPoints" INTEGER,
  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "effectiveUntil" TIMESTAMPTZ(3),
  "fundingSource" "RewardFundingSource" NOT NULL DEFAULT 'PLATFORM',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RewardPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardPolicy_values_check" CHECK ("version" > 0 AND "earnAmountMinor" > 0 AND "earnPoints" > 0 AND "redeemPoints" > 0 AND "redeemValueMinor" > 0 AND "expiryDays" > 0 AND ("maxEarnPoints" IS NULL OR "maxEarnPoints" > 0) AND ("maxRedeemPoints" IS NULL OR "maxRedeemPoints" > 0)),
  CONSTRAINT "RewardPolicy_window_check" CHECK ("effectiveUntil" IS NULL OR "effectiveFrom" < "effectiveUntil")
);

CREATE TABLE "RewardAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "availablePoints" INTEGER NOT NULL DEFAULT 0,
  "reservedPoints" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RewardAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardAccount_projection_check" CHECK ("reservedPoints" >= 0 AND "version" > 0)
);

CREATE TABLE "RewardTransaction" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT,
  "policyId" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "type" "RewardTransactionType" NOT NULL,
  "reason" "RewardReason" NOT NULL,
  "points" INTEGER NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3),
  "originalTransactionId" TEXT,
  "correlationId" VARCHAR(191),
  "idempotencyKey" VARCHAR(191) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardTransaction_points_check" CHECK (("type" IN ('PENDING_EARN', 'EARN_AVAILABLE') AND "points" > 0) OR ("type" IN ('EARN_REVERSED', 'POINTS_EXPIRED') AND "points" < 0)),
  CONSTRAINT "RewardTransaction_origin_check" CHECK (("type" = 'PENDING_EARN' AND "originalTransactionId" IS NULL) OR ("type" <> 'PENDING_EARN' AND "originalTransactionId" IS NOT NULL)),
  CONSTRAINT "RewardTransaction_version_check" CHECK ("policyVersion" > 0)
);

CREATE UNIQUE INDEX "RewardPolicy_policyCode_version_key" ON "RewardPolicy"("policyCode", "version");
CREATE INDEX "RewardPolicy_status_effectiveFrom_effectiveUntil_idx" ON "RewardPolicy"("status", "effectiveFrom", "effectiveUntil");
CREATE UNIQUE INDEX "RewardAccount_userId_key" ON "RewardAccount"("userId");
CREATE UNIQUE INDEX "RewardTransaction_idempotencyKey_key" ON "RewardTransaction"("idempotencyKey");
CREATE UNIQUE INDEX "RewardTransaction_originalTransactionId_type_key" ON "RewardTransaction"("originalTransactionId", "type");
CREATE INDEX "RewardTransaction_accountId_createdAt_idx" ON "RewardTransaction"("accountId", "createdAt");
CREATE INDEX "RewardTransaction_userId_createdAt_idx" ON "RewardTransaction"("userId", "createdAt");
CREATE INDEX "RewardTransaction_orderId_createdAt_idx" ON "RewardTransaction"("orderId", "createdAt");
CREATE INDEX "RewardTransaction_orderItemId_createdAt_idx" ON "RewardTransaction"("orderItemId", "createdAt");
CREATE INDEX "RewardTransaction_policyId_policyVersion_idx" ON "RewardTransaction"("policyId", "policyVersion");

ALTER TABLE "RewardAccount" ADD CONSTRAINT "RewardAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RewardAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "RewardPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_originalTransactionId_fkey" FOREIGN KEY ("originalTransactionId") REFERENCES "RewardTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
