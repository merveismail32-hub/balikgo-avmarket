ALTER TABLE "Order" ADD COLUMN "walletUse" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "walletTenderAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, ADD COLUMN "externalTenderAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, ADD COLUMN "tenderCurrency" CHAR(3);
CREATE TABLE "WalletTenderAllocation" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "paymentId" TEXT NOT NULL, "currency" CHAR(3) NOT NULL,
  "totalCustomerPayable" DECIMAL(18,2) NOT NULL, "walletTenderAmount" DECIMAL(18,2) NOT NULL,
  "externalTenderAmount" DECIMAL(18,2) NOT NULL, "walletAccountId" TEXT, "walletReservationId" TEXT,
  "allocationVersion" VARCHAR(40) NOT NULL, "idempotencyKey" VARCHAR(191) NOT NULL, "semanticHash" CHAR(64) NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL, "correlationId" VARCHAR(191), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletTenderAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletTenderAllocation_amount_check" CHECK ("totalCustomerPayable" >= 0 AND "walletTenderAmount" >= 0 AND "externalTenderAmount" >= 0 AND "totalCustomerPayable" = "walletTenderAmount" + "externalTenderAmount"),
  CONSTRAINT "WalletTenderAllocation_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "WalletTenderAllocation_orderId_key" ON "WalletTenderAllocation"("orderId");
CREATE UNIQUE INDEX "WalletTenderAllocation_paymentId_key" ON "WalletTenderAllocation"("paymentId");
CREATE UNIQUE INDEX "WalletTenderAllocation_idempotencyKey_key" ON "WalletTenderAllocation"("idempotencyKey");
CREATE INDEX "WalletTenderAllocation_walletAccountId_idx" ON "WalletTenderAllocation"("walletAccountId");
ALTER TABLE "WalletTenderAllocation" ADD CONSTRAINT "WalletTenderAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletTenderAllocation" ADD CONSTRAINT "WalletTenderAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
