import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { maskIban, maskTckn, maskVkn } from "../app/lib/financial-identity-validation";
import { evaluatePayoutTransferEligibility } from "../app/lib/payout-eligibility-domain";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const eligibility = evaluatePayoutTransferEligibility({ onboardingStatus: "APPROVED", activationEligible: true, sellerStatus: "APPROVED", taxTrusted: true, bankTrusted: true, holdActive: false, payoutStatus: "AVAILABLE", hasBlockingRefundOrDispute: false });
assert.equal(eligibility.transferEligible, true);
for (const mutation of [{ holdActive: true }, { taxTrusted: false }, { bankTrusted: false }, { sellerStatus: "SUSPENDED" as const }, { hasBlockingRefundOrDispute: true }, { payoutStatus: "BLOCKED" as const }]) {
  assert.equal(evaluatePayoutTransferEligibility({ onboardingStatus: "APPROVED", activationEligible: true, sellerStatus: "APPROVED", taxTrusted: true, bankTrusted: true, holdActive: false, payoutStatus: "AVAILABLE", hasBlockingRefundOrDispute: false, ...mutation }).transferEligible, false);
}
assert.equal(new Prisma.Decimal("90").minus("0").toFixed(2), "90.00");
for (const [masked, raw] of [[maskIban("invalid"), "invalid"], [maskTckn("invalid"), "invalid"], [maskVkn("invalid"), "invalid"]]) { assert.equal(masked, "••••"); assert(!masked.includes(raw)); }

const readModel = source("app/lib/finance-read-model.ts"), adminDto = source("app/lib/admin-seller-application-dto.ts"), payout = source("app/lib/payout-eligibility.ts"), schema = source("prisma/schema.prisma");
for (const reason of ["BANK_VERIFICATION_REQUIRED", "FINANCIAL_HOLD_ACTIVE", "KYB_NOT_APPROVED", "PAYOUT_NOT_AVAILABLE", "REFUND_OR_DISPUTE_BLOCK", "SELLER_NOT_ACTIVATED", "SELLER_NOT_OPERATIONAL", "TAX_VERIFICATION_REQUIRED"]) assert.match(readModel, new RegExp(`${reason}:\\s*\\{\\s*category:`));
assert.match(readModel, /evaluatePayoutTransferEligibility/);
assert.match(readModel, /economicallyAvailableAmount/); assert.match(readModel, /transferEligibleAmount/); assert.match(readModel, /temporarilyIneligibleAmount/);
assert.match(readModel, /getOwnSellerFinanceSummary\(authenticatedUserId/); assert.match(readModel, /financialIdentityReviewerEnabled/);
assert.doesNotMatch(readModel, /console\.(?:log|warn|error)/); assert.doesNotMatch(readModel, /return\s+profile\s*[;}]/);
assert.match(adminDto, /financialVerification/); assert.match(adminDto, /maskedTaxIdentifier/); assert.match(adminDto, /maskedIban/);
assert.match(adminDto, /taxVerifications:\s*_taxVerifications/); assert.match(adminDto, /financialIdentity:\s*_financialIdentity/);
assert.match(payout, /payoutStatus:\s*payout\.status/); assert.match(schema, /enum PayoutStatus[\s\S]*BLOCKED/);
assert.doesNotMatch(source("app/api/admin/seller-applications/route.ts"), /include:\s*\{/);
assert.doesNotMatch(source("app/api/admin/seller-applications/[id]/route.ts"), /getAdminSellerOnboarding/);
assert.doesNotMatch(`${readModel}\n${adminDto}`, /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/);
console.log("PASS: #20 Slice H cross-slice, UI-readiness, authorization, masking and finance-truth closeout contract");
