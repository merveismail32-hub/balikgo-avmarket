-- Additive, backward-compatible fields for quantity-aware return/refund execution.
ALTER TABLE "Refund" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Refund" ADD COLUMN "executionKey" VARCHAR(120);
ALTER TABLE "Refund" ADD COLUMN "providerOutcome" VARCHAR(32);
ALTER TABLE "Refund" ADD COLUMN "providerObservedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Refund_executionKey_key" ON "Refund"("executionKey");
CREATE INDEX "Refund_orderItemId_status_requestedAt_idx" ON "Refund"("orderItemId", "status", "requestedAt");
