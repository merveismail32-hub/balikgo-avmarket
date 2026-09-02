import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = [
  "20260831120000_financial_identity_primitives",
  "20260831123000_financial_evidence_context_integrity",
].map((name) => readFileSync(resolve(root, `prisma/migrations/${name}/migration.sql`), "utf8")).join("\n");

function model(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert(match, `${name} model missing`);
  return match[1];
}

const user = model("User");
const seller = model("SellerProfile");
const identity = model("SellerFinancialIdentity");
const bank = model("BankDestinationRevision");
const tax = model("TaxVerification");
const evidence = model("FinancialVerificationEvidence");
const payout = model("SellerPayout");
const ledger = model("FinancialLedgerEntry");

assert.match(user, /financialIdentityReviewerEnabled\s+Boolean\s+@default\(false\)/, "reviewer capability must default false");
assert.match(identity, /sellerId\s+String\s+@unique/, "financial identity must be seller-unique");
assert.match(identity, /currentBankDestinationRevisionId\s+String\?/, "partial identity shell must allow no bank destination");
assert.match(identity, /coordinationVersion\s+Int\s+@default\(0\)/, "coordination CAS version missing");
assert.match(identity, /holdActive\s+Boolean\s+@default\(true\)/, "identity shell must fail closed");
assert.doesNotMatch(identity, /payoutEligible|taxNumber|taxOffice|legalName|companyType|canonicalIban|beneficiaryName/, "financial identity duplicated canonical or derived authority");

assert.match(bank, /@@unique\(\[financialIdentityId, destinationVersion\]/, "bank revisions must be version-addressable");
assert.match(identity, /fields: \[id, currentBankDestinationRevisionId\], references: \[financialIdentityId, id\]/, "current bank pointer must enforce aggregate ownership");
assert.doesNotMatch(bank, /isCurrent/, "bank revision must not contain a second current marker");
assert.match(bank, /verificationStatus\s+FinancialVerificationStatus\s+@default\(UNVERIFIED\)/, "bank verification must default unverified");
assert.match(bank, /verificationAssurance\s+FinancialVerificationAssurance\s+@default\(LOCAL_CHECKS_ONLY\)/, "bank assurance must fail closed");

assert.match(tax, /onboardingVersion\s+Int/, "tax verification must bind onboarding version");
assert.match(tax, /normalizedFingerprint\s+String/, "tax verification must bind normalized fingerprint");
assert.match(tax, /@@unique\(\[sellerId, onboardingVersion, normalizedFingerprint\]/, "tax identity binding must be unique");
assert.doesNotMatch(tax, /taxNumber|taxOffice|legalName|companyType/, "tax verification must not duplicate canonical profile fields");
assert.match(seller, /taxNumber\s+String/, "SellerProfile must retain canonical tax ownership");

assert.doesNotMatch(evidence, /canonicalIban|beneficiaryName|taxNumber|taxOffice|legalName|companyType|rawPayload/, "evidence must not become a raw identity source");
assert.match(migration, /num_nonnulls\("bankDestinationRevisionId", "taxVerificationId"\) = 1/, "evidence must have exactly one verification context");
assert.match(migration, /CONSTRAINT "FinancialEvidence_seller_tax_fkey"[\s\S]*FOREIGN KEY \("sellerId", "taxVerificationId"\)/, "tax evidence seller ownership constraint missing");
assert.match(migration, /CONSTRAINT "FinancialEvidence_identity_bank_fkey"[\s\S]*FOREIGN KEY \("financialIdentityId", "bankDestinationRevisionId"\)/, "bank evidence aggregate ownership constraint missing");
assert.doesNotMatch(migration, /(?:^|\n)\s*(?:INSERT INTO|UPDATE|DELETE FROM)\b/i, "Slice A migration must not backfill or mutate business rows");
assert.doesNotMatch(migration, /ALTER TABLE "(?:SellerPayout|FinancialLedgerEntry)"/, "Slice A migration must not change payout or ledger schema");
assert.doesNotMatch(payout, /iban|beneficiary|financialIdentity|transferEligible/i, "SellerPayout semantics changed in Slice A");
assert.doesNotMatch(ledger, /iban|beneficiary|financialIdentity|transferEligible/i, "FinancialLedgerEntry semantics changed in Slice A");
assert.match(schema, /enum FinancialVerificationStatus \{[\s\S]*UNVERIFIED[\s\S]*PENDING[\s\S]*NEEDS_REVIEW[\s\S]*VERIFIED[\s\S]*REJECTED[\s\S]*REVERIFICATION_REQUIRED[\s\S]*?\}/, "verification lifecycle incomplete");
assert.match(schema, /enum FinancialVerificationAssurance \{[\s\S]*LOCAL_CHECKS_ONLY[\s\S]*DOCUMENT_REVIEWED[\s\S]*PROVIDER_VERIFIED[\s\S]*AUTHORITY_VERIFIED[\s\S]*?\}/, "assurance semantics incomplete");

console.log("PASS: #20 Slice A schema is additive, fail-closed, version-bound and preserves payout/ledger ownership");
