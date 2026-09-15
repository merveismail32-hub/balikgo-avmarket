CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE "WalletTransactionType" AS ENUM ('CREDIT', 'DEBIT_RESERVED', 'DEBIT_CAPTURED', 'DEBIT_RELEASED', 'REFUND_CREDIT', 'GIFT_CARD_CLAIM_CREDIT', 'EXPIRED', 'MANUAL_CREDIT', 'MANUAL_DEBIT');
CREATE TYPE "WalletFundingSource" AS ENUM ('PURCHASED_GIFT_CARD', 'PLATFORM_PROMOTIONAL', 'REFUND_RESTORATION', 'MANUAL_ADJUSTMENT');
CREATE TYPE "GiftCardStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'REDEEMED', 'VOIDED', 'EXPIRED');
CREATE TYPE "GiftCardEventType" AS ENUM ('ISSUED', 'ACTIVATED', 'CLAIMED', 'VOIDED', 'EXPIRED');

CREATE TABLE "WalletAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "availableBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "reservedBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletAccount_projection_check" CHECK ("availableBalance" >= 0 AND "reservedBalance" >= 0 AND "version" > 0),
  CONSTRAINT "WalletAccount_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "WalletAccount_closed_check" CHECK ("status" <> 'CLOSED' OR ("availableBalance" = 0 AND "reservedBalance" = 0))
);

CREATE TABLE "GiftCard" (
  "id" TEXT NOT NULL,
  "status" "GiftCardStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "currency" CHAR(3) NOT NULL,
  "issuedAmount" DECIMAL(18,2) NOT NULL,
  "remainingAmount" DECIMAL(18,2) NOT NULL,
  "fundingSource" "WalletFundingSource" NOT NULL,
  "sourceReference" VARCHAR(191) NOT NULL,
  "codeDigest" CHAR(64) NOT NULL,
  "maskedSuffix" CHAR(4) NOT NULL,
  "purchasePaymentId" TEXT,
  "purchaserUserId" TEXT,
  "activatedAt" TIMESTAMPTZ(3),
  "claimedAt" TIMESTAMPTZ(3),
  "claimedByUserId" TEXT,
  "expiresAt" TIMESTAMPTZ(3),
  "voidedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "issuanceIdempotencyKey" VARCHAR(191) NOT NULL,
  "issuanceSemanticHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiftCard_amount_check" CHECK ("issuedAmount" > 0 AND "remainingAmount" >= 0 AND "remainingAmount" <= "issuedAmount"),
  CONSTRAINT "GiftCard_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "GiftCard_version_check" CHECK ("version" > 0),
  CONSTRAINT "GiftCard_purchased_source_check" CHECK ("fundingSource" <> 'PURCHASED_GIFT_CARD' OR ("purchasePaymentId" IS NOT NULL AND "purchaserUserId" IS NOT NULL)),
  CONSTRAINT "GiftCard_state_check" CHECK (
    ("status" IN ('PENDING_PAYMENT','ACTIVE') AND "remainingAmount" = "issuedAmount" AND "claimedAt" IS NULL AND "claimedByUserId" IS NULL) OR
    ("status" = 'REDEEMED' AND "remainingAmount" = 0 AND "activatedAt" IS NOT NULL AND "claimedAt" IS NOT NULL AND "claimedByUserId" IS NOT NULL) OR
    ("status" IN ('VOIDED','EXPIRED') AND "remainingAmount" = 0 AND "claimedAt" IS NULL AND "claimedByUserId" IS NULL)
  )
);

CREATE TABLE "WalletTransaction" (
  "id" TEXT NOT NULL,
  "walletAccountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "type" "WalletTransactionType" NOT NULL,
  "fundingSource" "WalletFundingSource" NOT NULL,
  "sourceType" VARCHAR(60) NOT NULL,
  "sourceReference" VARCHAR(191) NOT NULL,
  "giftCardId" TEXT,
  "orderId" TEXT,
  "paymentId" TEXT,
  "refundId" TEXT,
  "availableBalanceBefore" DECIMAL(18,2) NOT NULL,
  "availableBalanceAfter" DECIMAL(18,2) NOT NULL,
  "reservedBalanceBefore" DECIMAL(18,2) NOT NULL,
  "reservedBalanceAfter" DECIMAL(18,2) NOT NULL,
  "accountVersionBefore" INTEGER NOT NULL,
  "accountVersionAfter" INTEGER NOT NULL,
  "idempotencyKey" VARCHAR(191) NOT NULL,
  "semanticHash" CHAR(64) NOT NULL,
  "correlationId" VARCHAR(191),
  "reason" VARCHAR(500) NOT NULL,
  "actorUserId" TEXT,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletTransaction_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "WalletTransaction_projection_check" CHECK ("availableBalanceBefore" >= 0 AND "availableBalanceAfter" >= 0 AND "reservedBalanceBefore" >= 0 AND "reservedBalanceAfter" >= 0 AND "accountVersionBefore" > 0 AND "accountVersionAfter" = "accountVersionBefore" + 1),
  CONSTRAINT "WalletTransaction_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "GiftCardLifecycleEvent" (
  "id" TEXT NOT NULL,
  "giftCardId" TEXT NOT NULL,
  "type" "GiftCardEventType" NOT NULL,
  "fromStatus" "GiftCardStatus",
  "toStatus" "GiftCardStatus" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "paymentReference" VARCHAR(191),
  "userId" TEXT,
  "idempotencyKey" VARCHAR(191) NOT NULL,
  "semanticHash" CHAR(64) NOT NULL,
  "correlationId" VARCHAR(191),
  "reason" VARCHAR(500) NOT NULL,
  "actorUserId" TEXT,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftCardLifecycleEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiftCardLifecycleEvent_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "GiftCardLifecycleEvent_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "WalletAccount_userId_currency_key" ON "WalletAccount"("userId", "currency");
CREATE INDEX "WalletAccount_status_updatedAt_idx" ON "WalletAccount"("status", "updatedAt");
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");
CREATE INDEX "WalletTransaction_walletAccountId_createdAt_idx" ON "WalletTransaction"("walletAccountId", "createdAt");
CREATE INDEX "WalletTransaction_userId_createdAt_idx" ON "WalletTransaction"("userId", "createdAt");
CREATE INDEX "WalletTransaction_giftCardId_createdAt_idx" ON "WalletTransaction"("giftCardId", "createdAt");
CREATE INDEX "WalletTransaction_orderId_createdAt_idx" ON "WalletTransaction"("orderId", "createdAt");
CREATE INDEX "WalletTransaction_paymentId_createdAt_idx" ON "WalletTransaction"("paymentId", "createdAt");
CREATE INDEX "WalletTransaction_refundId_createdAt_idx" ON "WalletTransaction"("refundId", "createdAt");
CREATE UNIQUE INDEX "GiftCard_codeDigest_key" ON "GiftCard"("codeDigest");
CREATE UNIQUE INDEX "GiftCard_issuanceIdempotencyKey_key" ON "GiftCard"("issuanceIdempotencyKey");
CREATE INDEX "GiftCard_status_expiresAt_idx" ON "GiftCard"("status", "expiresAt");
CREATE INDEX "GiftCard_purchasePaymentId_idx" ON "GiftCard"("purchasePaymentId");
CREATE INDEX "GiftCard_purchaserUserId_createdAt_idx" ON "GiftCard"("purchaserUserId", "createdAt");
CREATE INDEX "GiftCard_claimedByUserId_claimedAt_idx" ON "GiftCard"("claimedByUserId", "claimedAt");
CREATE UNIQUE INDEX "GiftCardLifecycleEvent_idempotencyKey_key" ON "GiftCardLifecycleEvent"("idempotencyKey");
CREATE INDEX "GiftCardLifecycleEvent_giftCardId_createdAt_idx" ON "GiftCardLifecycleEvent"("giftCardId", "createdAt");
CREATE INDEX "GiftCardLifecycleEvent_userId_createdAt_idx" ON "GiftCardLifecycleEvent"("userId", "createdAt");

ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_purchasePaymentId_fkey" FOREIGN KEY ("purchasePaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_purchaserUserId_fkey" FOREIGN KEY ("purchaserUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "WalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCardLifecycleEvent" ADD CONSTRAINT "GiftCardLifecycleEvent_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCardLifecycleEvent" ADD CONSTRAINT "GiftCardLifecycleEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
