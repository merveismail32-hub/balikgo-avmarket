import type { BankDestinationRevision, SellerFinancialIdentity } from "@prisma/client";
import { bankDestinationFingerprint, normalizeIdentityComparisonText, validateTrIban } from "./financial-identity-validation";

export class BankDestinationError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID_LOCAL_DESTINATION" | "STALE_CONTEXT" | "IDEMPOTENCY_CONFLICT", message: string) {
    super(message);
    this.name = "BankDestinationError";
  }
}

export function normalizeBeneficiaryName(value: unknown) {
  if (typeof value !== "string") throw new BankDestinationError("INVALID_LOCAL_DESTINATION", "Hesap sahibi adı geçersiz.");
  const canonical = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!canonical || canonical.length > 191) throw new BankDestinationError("INVALID_LOCAL_DESTINATION", "Hesap sahibi adı geçersiz.");
  return canonical;
}

export function buildBankDestinationContext(input: { financialIdentityId: string; iban: unknown; beneficiaryName: unknown }) {
  const iban = validateTrIban(input.iban);
  if (!iban.locallyValid) throw new BankDestinationError("INVALID_LOCAL_DESTINATION", `Banka hedefi yerel doğrulamadan geçmedi: ${iban.reasonCode}.`);
  const beneficiaryName = normalizeBeneficiaryName(input.beneficiaryName);
  return {
    financialIdentityId: input.financialIdentityId,
    canonicalIban: iban.normalizedValue,
    beneficiaryName,
    normalizedBeneficiaryName: normalizeIdentityComparisonText(beneficiaryName),
    normalizedFingerprint: bankDestinationFingerprint({ financialIdentityId: input.financialIdentityId, canonicalIban: iban.normalizedValue, beneficiaryName }),
    localValidation: iban,
  };
}

type IdentityPointer = Pick<SellerFinancialIdentity, "id" | "currentBankDestinationRevisionId">;
type RevisionBinding = Pick<BankDestinationRevision, "id" | "financialIdentityId" | "destinationVersion" | "canonicalIban" | "beneficiaryName" | "normalizedFingerprint">;

export function evaluateCurrentBankDestination(identity: IdentityPointer, revision: RevisionBinding) {
  const belongsToIdentity = revision.financialIdentityId === identity.id;
  const pointerMatches = identity.currentBankDestinationRevisionId === revision.id;
  const versionValid = Number.isInteger(revision.destinationVersion) && revision.destinationVersion > 0;
  const fingerprintConsistent = revision.normalizedFingerprint === bankDestinationFingerprint({
    financialIdentityId: revision.financialIdentityId,
    canonicalIban: revision.canonicalIban,
    beneficiaryName: revision.beneficiaryName,
  });
  return { belongsToIdentity, pointerMatches, versionValid, fingerprintConsistent, current: belongsToIdentity && pointerMatches && versionValid && fingerprintConsistent };
}
