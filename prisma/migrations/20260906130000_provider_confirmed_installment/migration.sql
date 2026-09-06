ALTER TYPE "PaymentReconciliationReason" ADD VALUE 'INSTALLMENT_COUNT_MISMATCH';

ALTER TABLE "Payment"
ADD COLUMN "providerConfirmedInstallmentCount" INTEGER;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_provider_confirmed_installment_check" CHECK (
  "providerConfirmedInstallmentCount" IS NULL
  OR "providerConfirmedInstallmentCount" IN (1, 3, 6, 9)
);
