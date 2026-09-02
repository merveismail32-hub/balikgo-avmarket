import "server-only";

import { createHash } from "node:crypto";

export type TaxIdentifierTypeValue = "TCKN" | "VKN";
export type LocalValidationReason = "REQUIRED" | "INVALID_TYPE" | "INVALID_COUNTRY" | "INVALID_LENGTH" | "INVALID_CHARACTERS" | "INVALID_STRUCTURE" | "INVALID_CHECKSUM";
export type LocalValidationAssurance = "LOCAL_CHECKS_ONLY";

type LocalValidationSuccess = {
  locallyValid: true;
  normalizedValue: string;
  reasonCode: null;
  assurance: LocalValidationAssurance;
  validationLevel: "CHECKSUM" | "STRUCTURE_ONLY";
};

type LocalValidationFailure = {
  locallyValid: false;
  normalizedValue: string | null;
  reasonCode: LocalValidationReason;
  assurance: LocalValidationAssurance;
  validationLevel: "CHECKSUM" | "STRUCTURE_ONLY";
};

export type LocalValidationResult = LocalValidationSuccess | LocalValidationFailure;
export type VknLocalValidationResult = LocalValidationResult & { checksumStatus: "VKN_CHECKSUM_DEFERRED_PENDING_TRUSTED_SPEC" };

const LOCAL_ASSURANCE = "LOCAL_CHECKS_ONLY" as const;
const TAX_FINGERPRINT_VERSION = "seller-tax-identity:v1";
const BANK_FINGERPRINT_VERSION = "seller-bank-destination:v1";
const MASKED_FALLBACK = "••••";

function normalizePresentationWhitespace(value: string) {
  return value.trim().replace(/\s/gu, "");
}

function invalid(normalizedValue: string | null, reasonCode: LocalValidationReason, validationLevel: "CHECKSUM" | "STRUCTURE_ONLY" = "CHECKSUM"): LocalValidationFailure {
  return { locallyValid: false, normalizedValue, reasonCode, assurance: LOCAL_ASSURANCE, validationLevel };
}

function valid(normalizedValue: string, validationLevel: "CHECKSUM" | "STRUCTURE_ONLY" = "CHECKSUM"): LocalValidationSuccess {
  return { locallyValid: true, normalizedValue, reasonCode: null, assurance: LOCAL_ASSURANCE, validationLevel };
}

export function normalizeTrIban(value: string) {
  return normalizePresentationWhitespace(value).replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

function ibanMod97(canonicalIban: string) {
  const rearranged = canonicalIban.slice(4) + canonicalIban.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const numeric = character >= "A" && character <= "Z" ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

export function validateTrIban(value: unknown): LocalValidationResult {
  if (typeof value !== "string") return invalid(null, "INVALID_TYPE");
  const normalizedValue = normalizeTrIban(value);
  if (!normalizedValue) return invalid(null, "REQUIRED");
  if (normalizedValue.slice(0, 2) !== "TR") return invalid(normalizedValue, "INVALID_COUNTRY");
  if (!/^[A-Z0-9]+$/.test(normalizedValue)) return invalid(normalizedValue, "INVALID_CHARACTERS");
  if (normalizedValue.length !== 26) return invalid(normalizedValue, "INVALID_LENGTH");
  if (!/^TR\d{8}[A-Z0-9]{16}$/.test(normalizedValue)) return invalid(normalizedValue, "INVALID_STRUCTURE");
  if (ibanMod97(normalizedValue) !== 1) return invalid(normalizedValue, "INVALID_CHECKSUM");
  return valid(normalizedValue);
}

export function normalizeTckn(value: string) {
  return normalizePresentationWhitespace(value);
}

export function validateTckn(value: unknown): LocalValidationResult {
  if (typeof value !== "string") return invalid(null, "INVALID_TYPE");
  const normalizedValue = normalizeTckn(value);
  if (!normalizedValue) return invalid(null, "REQUIRED");
  if (!/^\d+$/.test(normalizedValue)) return invalid(normalizedValue, "INVALID_CHARACTERS");
  if (normalizedValue.length !== 11) return invalid(normalizedValue, "INVALID_LENGTH");
  if (normalizedValue[0] === "0") return invalid(normalizedValue, "INVALID_STRUCTURE");
  const digits = [...normalizedValue].map(Number);
  const oddSum = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const evenSum = digits[1] + digits[3] + digits[5] + digits[7];
  const tenth = ((oddSum * 7 - evenSum) % 10 + 10) % 10;
  if (digits[9] !== tenth) return invalid(normalizedValue, "INVALID_CHECKSUM");
  if (digits[10] !== digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10) return invalid(normalizedValue, "INVALID_CHECKSUM");
  return valid(normalizedValue);
}

export function normalizeVkn(value: string) {
  return normalizePresentationWhitespace(value);
}

export function validateVkn(value: unknown): VknLocalValidationResult {
  const checksumStatus = "VKN_CHECKSUM_DEFERRED_PENDING_TRUSTED_SPEC" as const;
  if (typeof value !== "string") return { ...invalid(null, "INVALID_TYPE", "STRUCTURE_ONLY"), checksumStatus };
  const normalizedValue = normalizeVkn(value);
  if (!normalizedValue) return { ...invalid(null, "REQUIRED", "STRUCTURE_ONLY"), checksumStatus };
  if (!/^\d+$/.test(normalizedValue)) return { ...invalid(normalizedValue, "INVALID_CHARACTERS", "STRUCTURE_ONLY"), checksumStatus };
  if (normalizedValue.length !== 10) return { ...invalid(normalizedValue, "INVALID_LENGTH", "STRUCTURE_ONLY"), checksumStatus };
  return { ...valid(normalizedValue, "STRUCTURE_ONLY"), checksumStatus };
}

export function validateTaxIdentifier(identifierType: TaxIdentifierTypeValue, value: unknown) {
  return identifierType === "TCKN" ? validateTckn(value) : validateVkn(value);
}

export function normalizeIdentityComparisonText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("tr-TR").replace(/\s+/gu, " ").trim();
}

function sha256Canonical(fields: ReadonlyArray<readonly [string, string | number]>) {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export function taxIdentityFingerprint(input: {
  sellerId: string;
  onboardingVersion: number;
  identifierType: TaxIdentifierTypeValue;
  canonicalIdentifier: string;
  legalName: string;
  companyType: string;
  taxOffice: string;
}) {
  return sha256Canonical([
    ["version", TAX_FINGERPRINT_VERSION],
    ["sellerId", input.sellerId],
    ["onboardingVersion", input.onboardingVersion],
    ["identifierType", input.identifierType],
    ["canonicalIdentifier", input.canonicalIdentifier],
    ["legalName", normalizeIdentityComparisonText(input.legalName)],
    ["companyType", normalizeIdentityComparisonText(input.companyType)],
    ["taxOffice", normalizeIdentityComparisonText(input.taxOffice)],
  ]);
}

export function bankDestinationFingerprint(input: { financialIdentityId: string; canonicalIban: string; beneficiaryName: string }) {
  return sha256Canonical([
    ["version", BANK_FINGERPRINT_VERSION],
    ["financialIdentityId", input.financialIdentityId],
    ["canonicalIban", input.canonicalIban],
    ["beneficiaryName", normalizeIdentityComparisonText(input.beneficiaryName)],
  ]);
}

export function maskIban(value: unknown) {
  const result = validateTrIban(value);
  return result.locallyValid ? `${result.normalizedValue.slice(0, 2)}${"•".repeat(20)}${result.normalizedValue.slice(-4)}` : MASKED_FALLBACK;
}

export function maskTckn(value: unknown) {
  const result = validateTckn(value);
  return result.locallyValid ? `${"•".repeat(7)}${result.normalizedValue.slice(-4)}` : MASKED_FALLBACK;
}

export function maskVkn(value: unknown) {
  const result = validateVkn(value);
  return result.locallyValid ? `${"•".repeat(6)}${result.normalizedValue.slice(-4)}` : MASKED_FALLBACK;
}
