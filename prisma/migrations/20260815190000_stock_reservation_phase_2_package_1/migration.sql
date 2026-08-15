-- Additive Stock Truth Engine Phase 2 Package 1 reservation lifecycle.
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'RESERVATION_RELEASE';

CREATE TYPE "StockReservationState" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');
CREATE TYPE "StockReleaseReason" AS ENUM ('PAYMENT_FAILED', 'PAYMENT_EXPIRED', 'CUSTOMER_CANCELLATION', 'SELLER_CANCELLATION', 'ADMIN_CANCELLATION');

ALTER TABLE "Payment"
  ADD COLUMN "reservationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "stockReleasedAt" TIMESTAMP(3),
  ADD COLUMN "stockReleaseReason" "StockReleaseReason";

ALTER TABLE "OrderItem"
  ADD COLUMN "stockReservationState" "StockReservationState",
  ADD COLUMN "stockReservationReleasedAt" TIMESTAMP(3),
  ADD COLUMN "stockReservationReleaseReason" "StockReleaseReason",
  ADD COLUMN "stockReservationVersion" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Payment_status_reservationExpiresAt_idx" ON "Payment"("status", "reservationExpiresAt");
CREATE INDEX "OrderItem_orderId_stockReservationState_idx" ON "OrderItem"("orderId", "stockReservationState");
