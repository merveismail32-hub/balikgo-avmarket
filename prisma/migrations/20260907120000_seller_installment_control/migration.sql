CREATE TYPE "SellerInstallmentAuthorizationMode" AS ENUM ('DISABLED', 'REQUEST_ONLY', 'DELEGATED');

CREATE TABLE "SellerInstallmentControl" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "authorizationMode" "SellerInstallmentAuthorizationMode" NOT NULL DEFAULT 'DISABLED',
  "delegatedAllowedInstallments" JSONB NOT NULL DEFAULT '[1]'::jsonb,
  "participationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "sellerPreferenceAllowedInstallments" JSONB NOT NULL DEFAULT '[1]'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerInstallmentControl_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SellerInstallmentControl_version_check" CHECK ("version" >= 1),
  CONSTRAINT "SellerInstallmentControl_delegated_check" CHECK (
    jsonb_typeof("delegatedAllowedInstallments") = 'array'
    AND "delegatedAllowedInstallments" @> '[1]'::jsonb
    AND "delegatedAllowedInstallments" <@ '[1, 3, 6, 9]'::jsonb
  ),
  CONSTRAINT "SellerInstallmentControl_preference_check" CHECK (
    jsonb_typeof("sellerPreferenceAllowedInstallments") = 'array'
    AND "sellerPreferenceAllowedInstallments" @> '[1]'::jsonb
    AND "sellerPreferenceAllowedInstallments" <@ '[1, 3, 6, 9]'::jsonb
  )
);

CREATE TABLE "SellerInstallmentControlAudit" (
  "id" TEXT NOT NULL,
  "controlId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorRole" "UserRole" NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "previousState" JSONB,
  "newState" JSONB NOT NULL,
  "expectedVersion" INTEGER,
  "previousVersion" INTEGER,
  "newVersion" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerInstallmentControlAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SellerInstallmentControlAudit_versions_check" CHECK (
    "newVersion" >= 1
    AND ("previousVersion" IS NULL OR "previousVersion" >= 1)
    AND ("expectedVersion" IS NULL OR "expectedVersion" >= 1)
  )
);

CREATE UNIQUE INDEX "SellerInstallmentControl_seller_key" ON "SellerInstallmentControl"("sellerId");
CREATE INDEX "SellerInstallmentControlAudit_seller_created_idx" ON "SellerInstallmentControlAudit"("sellerId", "createdAt");
CREATE INDEX "SellerInstallmentControlAudit_control_version_idx" ON "SellerInstallmentControlAudit"("controlId", "newVersion");
CREATE INDEX "SellerInstallmentControlAudit_actor_created_idx" ON "SellerInstallmentControlAudit"("actorUserId", "createdAt");

ALTER TABLE "SellerInstallmentControl"
  ADD CONSTRAINT "SellerInstallmentControl_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerInstallmentControlAudit"
  ADD CONSTRAINT "SellerInstallmentControlAudit_controlId_fkey"
  FOREIGN KEY ("controlId") REFERENCES "SellerInstallmentControl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerInstallmentControlAudit"
  ADD CONSTRAINT "SellerInstallmentControlAudit_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerInstallmentControlAudit"
  ADD CONSTRAINT "SellerInstallmentControlAudit_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
