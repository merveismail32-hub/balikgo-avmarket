CREATE TYPE "WalletTenderLifecycleStatus" AS ENUM ('RESERVED', 'CAPTURED', 'RELEASED');

ALTER TABLE "WalletTenderAllocation"
  ADD COLUMN "lifecycleStatus" "WalletTenderLifecycleStatus" NOT NULL DEFAULT 'RESERVED',
  ADD COLUMN "capturedTransactionId" TEXT,
  ADD COLUMN "releasedTransactionId" TEXT,
  ADD COLUMN "capturedAt" TIMESTAMPTZ(3),
  ADD COLUMN "releasedAt" TIMESTAMPTZ(3),
  ADD COLUMN "lifecycleIdempotencyKey" VARCHAR(191);

CREATE UNIQUE INDEX "WalletTenderAllocation_capturedTransactionId_key" ON "WalletTenderAllocation"("capturedTransactionId");
CREATE UNIQUE INDEX "WalletTenderAllocation_releasedTransactionId_key" ON "WalletTenderAllocation"("releasedTransactionId");
CREATE UNIQUE INDEX "WalletTenderAllocation_lifecycleIdempotencyKey_key" ON "WalletTenderAllocation"("lifecycleIdempotencyKey");
