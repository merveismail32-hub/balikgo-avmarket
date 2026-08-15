-- Additive Stock Truth Engine Phase 2 Package 2 expiry and reconciliation lifecycle.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

CREATE TYPE "PaymentReconciliationReviewStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');
CREATE TYPE "PaymentReconciliationReason" AS ENUM ('LATE_PAYMENT_SUCCESS', 'EXPIRY_FULFILLMENT_CONFLICT', 'EXPIRY_RELEASE_FAILED', 'PAYMENT_STOCK_STATE_MISMATCH');
CREATE TYPE "PaymentReconciliationPriority" AS ENUM ('HIGH', 'CRITICAL');

ALTER TABLE "Payment"
  ADD COLUMN "expiredAt" TIMESTAMP(3),
  ADD COLUMN "expiryClaimToken" VARCHAR(64),
  ADD COLUMN "expiryClaimedAt" TIMESTAMP(3),
  ADD COLUMN "expiryClaimExpiresAt" TIMESTAMP(3);

CREATE TABLE "PaymentReconciliationReview" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "paymentEventId" TEXT,
  "reason" "PaymentReconciliationReason" NOT NULL,
  "terminalStatus" "PaymentStatus" NOT NULL,
  "status" "PaymentReconciliationReviewStatus" NOT NULL DEFAULT 'PENDING',
  "priority" "PaymentReconciliationPriority" NOT NULL DEFAULT 'HIGH',
  "fingerprint" CHAR(64) NOT NULL,
  "openFingerprint" CHAR(64),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  CONSTRAINT "PaymentReconciliationReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_expiryClaimToken_key" ON "Payment"("expiryClaimToken");
CREATE INDEX "Payment_status_reservationExpiresAt_expiryClaimExpiresAt_idx" ON "Payment"("status", "reservationExpiresAt", "expiryClaimExpiresAt");
CREATE UNIQUE INDEX "PaymentReconciliationReview_openFingerprint_key" ON "PaymentReconciliationReview"("openFingerprint");
CREATE INDEX "PaymentReconciliationReview_paymentId_status_createdAt_idx" ON "PaymentReconciliationReview"("paymentId", "status", "createdAt");
CREATE INDEX "PaymentReconciliationReview_status_priority_createdAt_idx" ON "PaymentReconciliationReview"("status", "priority", "createdAt");
CREATE INDEX "PaymentReconciliationReview_paymentEventId_idx" ON "PaymentReconciliationReview"("paymentEventId");
CREATE INDEX "PaymentReconciliationReview_resolvedByUserId_idx" ON "PaymentReconciliationReview"("resolvedByUserId");
ALTER TABLE "PaymentReconciliationReview" ADD CONSTRAINT "PaymentReconciliationReview_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReconciliationReview" ADD CONSTRAINT "PaymentReconciliationReview_paymentEventId_fkey" FOREIGN KEY ("paymentEventId") REFERENCES "PaymentEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentReconciliationReview" ADD CONSTRAINT "PaymentReconciliationReview_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
