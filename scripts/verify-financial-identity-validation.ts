import assert from "node:assert/strict";
import {
  bankDestinationFingerprint,
  maskIban,
  maskTckn,
  maskVkn,
  normalizeIdentityComparisonText,
  taxIdentityFingerprint,
  validateTaxIdentifier,
  validateTckn,
  validateTrIban,
  validateVkn,
} from "../app/lib/financial-identity-validation.ts";

// TCMB IBAN Communique Appendix example; it proves only local structure/checksum validity.
const validIban = "TR470000100100000350930001";
const iban = validateTrIban(validIban);
assert(iban.locallyValid);
assert.equal(iban.normalizedValue, validIban);
assert.equal(iban.assurance, "LOCAL_CHECKS_ONLY");
assert.equal(iban.validationLevel, "CHECKSUM");
assert.deepEqual(validateTrIban(" tr47 0000 1001 0000 0350 9300 01 "), iban);
assert.equal(validateTrIban("DE470000100100000350930001").reasonCode, "INVALID_COUNTRY");
assert.equal(validateTrIban(validIban.slice(0, -1)).reasonCode, "INVALID_LENGTH");
assert.equal(validateTrIban("TR47-0000100100000350930001").reasonCode, "INVALID_CHARACTERS");
assert.equal(validateTrIban("TR47Ğ000100100000350930001").reasonCode, "INVALID_CHARACTERS");
assert.equal(validateTrIban("TRAA0000100100000350930001").reasonCode, "INVALID_STRUCTURE");
assert.equal(validateTrIban("TR480000100100000350930001").reasonCode, "INVALID_CHECKSUM");
const mutatedIban = `${validIban.slice(0, 20)}1${validIban.slice(21)}`;
assert.equal(validateTrIban(mutatedIban).locallyValid, false);
assert.equal(validateTrIban(Number(validIban)).reasonCode, "INVALID_TYPE");

// Synthetic checksum-valid fixture built for tests; it is not evidence that a person exists.
const syntheticTckn = "10000000146";
const tckn = validateTckn(syntheticTckn);
assert(tckn.locallyValid);
assert.equal(tckn.normalizedValue, syntheticTckn);
assert.equal(tckn.assurance, "LOCAL_CHECKS_ONLY");
assert.equal(validateTckn(" 100 000 001 46 ").normalizedValue, syntheticTckn);
assert.equal(validateTckn("123").reasonCode, "INVALID_LENGTH");
assert.equal(validateTckn("1000000014X").reasonCode, "INVALID_CHARACTERS");
assert.equal(validateTckn("00000000146").reasonCode, "INVALID_STRUCTURE");
assert.equal(validateTckn("10000000156").reasonCode, "INVALID_CHECKSUM");
assert.equal(validateTckn("10000000147").reasonCode, "INVALID_CHECKSUM");
assert.equal(validateTckn("10000000145").locallyValid, false);
assert.equal(validateTckn(10000000146).reasonCode, "INVALID_TYPE");

const vkn = validateVkn(" 123 456 7890 ");
assert(vkn.locallyValid);
assert.equal(vkn.normalizedValue, "1234567890");
assert.equal(vkn.validationLevel, "STRUCTURE_ONLY");
assert.equal(vkn.assurance, "LOCAL_CHECKS_ONLY");
assert.equal(vkn.checksumStatus, "VKN_CHECKSUM_DEFERRED_PENDING_TRUSTED_SPEC");
assert.equal(validateVkn("123456789").reasonCode, "INVALID_LENGTH");
assert.equal(validateVkn("12345-7890").reasonCode, "INVALID_CHARACTERS");
assert.equal(validateVkn(1234567890).reasonCode, "INVALID_TYPE");
assert.equal(validateTaxIdentifier("TCKN", syntheticTckn).locallyValid, true);
assert.equal(validateTaxIdentifier("VKN", "1234567890").locallyValid, true);

assert.equal(normalizeIdentityComparisonText("  İSTANBUL   Balıkçılık A.Ş. "), "istanbul balıkçılık a.ş.");
assert.equal(normalizeIdentityComparisonText("IŞIK"), "ışık");

const taxBase = { sellerId: "seller-a", onboardingVersion: 3, identifierType: "VKN" as const, canonicalIdentifier: "1234567890", legalName: "Balıkçılık A.Ş.", companyType: "Anonim Şirket", taxOffice: "Kadıköy" };
const taxFingerprint = taxIdentityFingerprint(taxBase);
assert.match(taxFingerprint, /^[a-f0-9]{64}$/);
assert.equal(taxFingerprint, taxIdentityFingerprint({ ...taxBase, legalName: "  BALIKÇILIK   a.ş. " }));
assert.notEqual(taxFingerprint, taxIdentityFingerprint({ ...taxBase, canonicalIdentifier: "1234567891" }));
assert.notEqual(taxFingerprint, taxIdentityFingerprint({ ...taxBase, legalName: "Başka A.Ş." }));
assert.notEqual(taxFingerprint, taxIdentityFingerprint({ ...taxBase, onboardingVersion: 4 }));
assert.notEqual(taxIdentityFingerprint({ ...taxBase, legalName: "ab", companyType: "c" }), taxIdentityFingerprint({ ...taxBase, legalName: "a", companyType: "bc" }));

const bankBase = { financialIdentityId: "financial-a", canonicalIban: validIban, beneficiaryName: "Balıkçılık A.Ş." };
const bankFingerprint = bankDestinationFingerprint(bankBase);
assert.equal(bankFingerprint, bankDestinationFingerprint({ ...bankBase, beneficiaryName: "  BALIKÇILIK   a.ş. " }));
assert.notEqual(bankFingerprint, bankDestinationFingerprint({ ...bankBase, canonicalIban: "TR330006100519786457841326" }));
assert.notEqual(bankFingerprint, bankDestinationFingerprint({ ...bankBase, beneficiaryName: "Başka A.Ş." }));

const ibanMask = maskIban(validIban), tcknMask = maskTckn(syntheticTckn), vknMask = maskVkn("1234567890");
assert(!ibanMask.includes(validIban) && ibanMask.endsWith("0001") && ibanMask.startsWith("TR"));
assert(!tcknMask.includes(syntheticTckn) && tcknMask.endsWith("0146"));
assert(!vknMask.includes("1234567890") && vknMask.endsWith("7890"));
for (const [masked, raw] of [[maskIban("malformed-secret"), "malformed-secret"], [maskTckn("secret"), "secret"], [maskVkn("secret"), "secret"]]) assert(!masked.includes(raw) && masked === "••••");
assert.equal(maskIban(validIban), ibanMask);
assert.equal(maskTckn(syntheticTckn), tcknMask);
assert.equal(maskVkn("1234567890"), vknMask);

for (const result of [iban, tckn, vkn]) {
  assert.equal(result.assurance, "LOCAL_CHECKS_ONLY");
  assert(!Object.values(result).includes("DOCUMENT_REVIEWED"));
  assert(!Object.values(result).includes("PROVIDER_VERIFIED"));
  assert(!Object.values(result).includes("AUTHORITY_VERIFIED"));
  assert(!("verified" in result));
}

console.log("PASS: #20 Slice B local IBAN/TCKN validation, structural VKN validation, fingerprints, masking and assurance boundaries");
