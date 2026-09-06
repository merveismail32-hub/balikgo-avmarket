-- #24 Slice E: immutable checkout-time commercial installment authority evidence.
-- Nullable and additive: legacy Payment rows remain uninterpreted.
ALTER TABLE "Payment"
ADD COLUMN "installmentCommercialSnapshot" JSONB;
