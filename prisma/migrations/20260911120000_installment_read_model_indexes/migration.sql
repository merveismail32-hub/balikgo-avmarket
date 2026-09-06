-- #24 Slice F: bounded seller policy and deterministic audit read-model access paths.
CREATE INDEX "InstallmentCommercialPolicy_seller_effective_idx"
ON "InstallmentCommercialPolicy"("sellerId", "effectiveFrom");

CREATE INDEX "InstallmentCommercialPolicyAudit_created_id_idx"
ON "InstallmentCommercialPolicyAudit"("createdAt", "id");
