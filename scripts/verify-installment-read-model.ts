import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toCustomerInstallmentReadModel } from "../app/lib/installment-read-model";

const root = resolve(import.meta.dirname, "..");
const service = readFileSync(resolve(root, "app/lib/installment-read-model.ts"), "utf8");
const adminRoute = readFileSync(resolve(root, "app/api/admin/installment-control-plane/route.ts"), "utf8");
const sellerRoute = readFileSync(resolve(root, "app/api/seller/installment-read-model/route.ts"), "utf8");
const customerSelect = readFileSync(resolve(root, "app/lib/customer-order-select.ts"), "utf8");
const customerDto = readFileSync(resolve(root, "app/lib/customer-shipment-dto.ts"), "utf8");
const migration = readFileSync(resolve(root, "prisma/migrations/20260911120000_installment_read_model_indexes/migration.sql"), "utf8");

assert.match(service, /take:\s*take \+ 1/);
assert.match(service, /take:\s*20/g);
assert.match(service, /orderBy:\s*\[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
assert.match(service, /resolveCheckoutCommercialInstallments/);
assert.doesNotMatch(service, /resolveEffectiveInstallments|MARKETPLACE_ALLOWED_INSTALLMENTS/);
assert.match(adminRoute, /session\.user\.role !== "ADMIN"/);
assert.match(sellerRoute, /session\.user\.role !== "SELLER"/);
assert.doesNotMatch(sellerRoute, /sellerId/);
for (const source of [customerSelect, customerDto]) {
  assert.doesNotMatch(source, /installmentCommercialSnapshot|installmentPolicyReference|installmentProviderCapabilityReference|approvedFromRequestId|sellerInstallmentControl/);
}
assert.match(migration, /InstallmentCommercialPolicy_seller_effective_idx/);
assert.match(migration, /InstallmentCommercialPolicyAudit_created_id_idx/);
assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE FROM|INSERT INTO|DROP|TRUNCATE)\b/i);
assert.deepEqual(toCustomerInstallmentReadModel({ effectiveInstallmentOptions: [1, 3], selectedInstallmentCount: 3 }), { effectiveInstallmentOptions: [1, 3], selectedInstallmentCount: 3, availabilityReason: "AVAILABLE" });
assert.deepEqual(Object.keys(toCustomerInstallmentReadModel({ effectiveInstallmentOptions: [1] })).sort(), ["availabilityReason", "effectiveInstallmentOptions", "selectedInstallmentCount"].sort());
console.log("PASS: #24 Slice F bounded read models, server RBAC, customer boundary and index readiness contracts");
