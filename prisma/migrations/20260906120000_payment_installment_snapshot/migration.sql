ALTER TABLE "Payment"
ADD COLUMN "selectedInstallmentCount" INTEGER,
ADD COLUMN "installmentPolicySource" VARCHAR(40),
ADD COLUMN "installmentPolicyReference" VARCHAR(120),
ADD COLUMN "installmentPolicyVersion" VARCHAR(80),
ADD COLUMN "installmentProvider" VARCHAR(40),
ADD COLUMN "installmentProviderCapabilitySource" VARCHAR(60),
ADD COLUMN "installmentProviderCapabilityReference" VARCHAR(120);

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_installment_snapshot_check" CHECK (
  (
    "selectedInstallmentCount" IS NULL
    AND "installmentPolicySource" IS NULL
    AND "installmentPolicyReference" IS NULL
    AND "installmentPolicyVersion" IS NULL
    AND "installmentProvider" IS NULL
    AND "installmentProviderCapabilitySource" IS NULL
    AND "installmentProviderCapabilityReference" IS NULL
  )
  OR
  (
    "selectedInstallmentCount" IN (1, 3, 6, 9)
    AND "installmentPolicySource" IS NOT NULL
    AND "installmentPolicyReference" IS NOT NULL
    AND "installmentPolicyVersion" IS NOT NULL
    AND "installmentProvider" IS NOT NULL
    AND "installmentProviderCapabilitySource" IS NOT NULL
    AND "installmentProviderCapabilityReference" IS NOT NULL
  )
);
