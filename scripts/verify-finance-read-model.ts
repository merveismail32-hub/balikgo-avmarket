import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toAdminSellerApplicationSummaryDto } from "../app/lib/admin-seller-application-dto";
import { maskIban, maskTckn, maskVkn } from "../app/lib/financial-identity-validation";

const rawTckn = "10000000146", rawVkn = "1234567890", rawIban = "TR470000100100000350930001";
const base = { id: "seller", storeName: "Store", legalName: "Legal", companyType: "Company", phone: "0", taxNumber: rawTckn, taxOffice: "Office", city: "City", address: "Address", categories: "", description: "", onboardingStatus: "APPROVED" as const, revisionReason: null, activationEligible: true, onboardingVersion: 1, createdAt: new Date("2026-01-01T00:00:00Z"), submittedAt: null, authorizedPersonName: "A", authorizedPersonSurname: "B", authorizedPersonEmail: "a@invalid.local", authorizedPersonTitle: "Owner", user: { name: "A", surname: "B", email: "a@invalid.local", phone: "0" }, kybDocuments: [], taxVerifications: [], financialIdentity: null };
const dto = toAdminSellerApplicationSummaryDto(base);
assert.equal(dto.maskedTaxIdentifier, maskTckn(rawTckn));
assert(!("taxNumber" in dto));
assert(!JSON.stringify(dto).includes(rawTckn));
assert.equal(dto.financialVerification.tax.current, false);
assert.equal(dto.financialVerification.bank.maskedIban, "••••");
assert.equal(toAdminSellerApplicationSummaryDto({ ...base, taxNumber: rawVkn }).maskedTaxIdentifier, maskVkn(rawVkn));
for (const [masked, raw] of [[maskIban("malformed-iban"), "malformed-iban"], [maskTckn("malformed-tax"), "malformed-tax"], [maskVkn("malformed-tax"), "malformed-tax"]]) { assert.equal(masked, "••••"); assert(!masked.includes(raw)); }
assert.equal(maskIban(rawIban), maskIban(rawIban));

const root = resolve(import.meta.dirname, "..");
const route = readFileSync(resolve(root, "app/api/admin/seller-applications/route.ts"), "utf8");
const detailRoute = readFileSync(resolve(root, "app/api/admin/seller-applications/[id]/route.ts"), "utf8");
const page = readFileSync(resolve(root, "app/admin/satici-basvurulari/page.tsx"), "utf8");
const readModel = readFileSync(resolve(root, "app/lib/finance-read-model.ts"), "utf8");
assert.match(route, /select:\s*adminSellerApplicationSummarySelect/);
assert.match(route, /profiles\.map\(toAdminSellerApplicationSummaryDto\)/);
assert.doesNotMatch(route, /include:\s*\{\s*user/);
assert.match(detailRoute, /select:\s*adminSellerApplicationSummarySelect/);
assert.match(detailRoute, /toAdminSellerApplicationSummaryDto\(application\)/);
assert.doesNotMatch(detailRoute, /getAdminSellerOnboarding/);
assert.match(page, /select:\s*adminSellerApplicationSummarySelect/);
assert.doesNotMatch(readModel, /console\.(?:log|error|warn)/);
assert.doesNotMatch(readModel, /return\s+profile\s*[;}]/);
console.log("PASS: #20 Slice G masked application DTO, overfetch hardening and no-log read-model contract");
