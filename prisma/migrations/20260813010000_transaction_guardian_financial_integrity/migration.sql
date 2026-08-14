ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIAL_REFUND_PENDING';

ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'SALE_REVERSAL';
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'COMMISSION_REVERSAL';

ALTER TABLE "FinancialLedgerEntry"
  ADD COLUMN "refundId" TEXT,
  ADD COLUMN "dedupeKey" VARCHAR(191);

CREATE UNIQUE INDEX "FinancialLedgerEntry_dedupeKey_key"
  ON "FinancialLedgerEntry"("dedupeKey");
CREATE INDEX "FinancialLedgerEntry_refundId_createdAt_idx"
  ON "FinancialLedgerEntry"("refundId", "createdAt");

ALTER TABLE "FinancialLedgerEntry"
  ADD CONSTRAINT "FinancialLedgerEntry_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "Refund"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
