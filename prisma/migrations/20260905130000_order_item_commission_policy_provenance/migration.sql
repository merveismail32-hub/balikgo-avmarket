ALTER TABLE "OrderItem"
  ADD COLUMN "commissionPolicySource" VARCHAR(40),
  ADD COLUMN "commissionPolicyReference" VARCHAR(100),
  ADD COLUMN "commissionAgreementId" TEXT,
  ADD COLUMN "commissionAgreementVersion" INTEGER;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_commission_policy_provenance_check" CHECK (
    (
      "commissionPolicySource" IS NULL
      AND "commissionPolicyReference" IS NULL
      AND "commissionAgreementId" IS NULL
      AND "commissionAgreementVersion" IS NULL
    )
    OR (
      "commissionPolicySource" = 'SELLER_CATEGORY_AGREEMENT'
      AND "commissionPolicyReference" IS NULL
      AND "commissionAgreementId" IS NOT NULL
      AND "commissionAgreementVersion" >= 1
    )
    OR (
      "commissionPolicySource" IN ('GLOBAL_CONFIG', 'DEFAULT_FALLBACK')
      AND "commissionPolicyReference" IS NOT NULL
      AND "commissionAgreementId" IS NULL
      AND "commissionAgreementVersion" IS NULL
    )
  );
