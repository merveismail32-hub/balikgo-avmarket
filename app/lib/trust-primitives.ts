export type ValidationOutcome<ReasonCode extends string = string> = Readonly<
  | { valid: true; reasonCode: null }
  | { valid: false; reasonCode: ReasonCode }
>;

export type VerificationSourceDescriptor<SourceKind extends string = string> = Readonly<{
  kind: SourceKind;
  authenticated: boolean;
  evidencePresent: boolean;
}>;

export type TrustBindingPart = string | number | boolean | null;

export type TrustBinding<Parts extends readonly TrustBindingPart[] = readonly TrustBindingPart[]> = Readonly<{
  parts: Parts;
}>;

export type SharedTrustReasonCode =
  | "NOT_VERIFIED"
  | "UNAUTHENTICATED_SOURCE"
  | "MISSING_EVIDENCE"
  | "WRONG_BINDING"
  | "STALE"
  | "INSUFFICIENT_POLICY"
  | "UNKNOWN"
  | "MALFORMED"
  | "REVOKED"
  | "EXPIRED"
  | "SUPERSEDED";

export type TrustDecision = Readonly<{
  trusted: boolean;
  verified: boolean;
  bindingMatches: boolean;
  current: boolean;
  reasonCodes: readonly SharedTrustReasonCode[];
}>;

export type ApplicabilityDecision = TrustDecision & Readonly<{
  applicable: boolean;
  policySatisfied: boolean;
}>;

export function isSafeReasonCode(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && /^[A-Z][A-Z0-9_:-]*$/.test(value);
}

export function compareTrustBinding<Parts extends readonly TrustBindingPart[]>(expected: TrustBinding<Parts>, observed: unknown): boolean {
  if (!Array.isArray(expected.parts) || expected.parts.length === 0 || !observed || typeof observed !== "object" || !("parts" in observed)) return false;
  const observedParts = (observed as { parts?: unknown }).parts;
  if (!Array.isArray(observedParts) || observedParts.length !== expected.parts.length) return false;
  return expected.parts.every((part, index) => part !== undefined && observedParts[index] !== undefined && Object.is(part, observedParts[index]));
}

export function evaluateApplicability(input: Readonly<{
  verified: boolean;
  source: VerificationSourceDescriptor | null | undefined;
  bindingMatches: boolean;
  current: boolean;
  policySatisfied: boolean;
  unknown?: boolean;
  malformed?: boolean;
  revoked?: boolean;
  expired?: boolean;
  superseded?: boolean;
}>): ApplicabilityDecision {
  const reasonCodes: SharedTrustReasonCode[] = [];
  if (!input.verified) reasonCodes.push("NOT_VERIFIED");
  if (!input.source?.authenticated) reasonCodes.push("UNAUTHENTICATED_SOURCE");
  if (!input.source?.evidencePresent) reasonCodes.push("MISSING_EVIDENCE");
  if (!input.bindingMatches) reasonCodes.push("WRONG_BINDING");
  if (!input.current) reasonCodes.push("STALE");
  if (!input.policySatisfied) reasonCodes.push("INSUFFICIENT_POLICY");
  if (input.unknown) reasonCodes.push("UNKNOWN");
  if (input.malformed) reasonCodes.push("MALFORMED");
  if (input.revoked) reasonCodes.push("REVOKED");
  if (input.expired) reasonCodes.push("EXPIRED");
  if (input.superseded) reasonCodes.push("SUPERSEDED");
  const trusted = reasonCodes.every((reason) => reason === "INSUFFICIENT_POLICY") && input.verified;
  return {
    trusted,
    applicable: trusted && input.policySatisfied,
    verified: input.verified,
    bindingMatches: input.bindingMatches,
    current: input.current,
    policySatisfied: input.policySatisfied,
    reasonCodes,
  };
}

export type ReplayDecision = "NEW" | "SAFE_REPLAY" | "CONFLICT";

export function classifyReplay(input: Readonly<{ sameKey: boolean; bindingMatches: boolean; intentMatches: boolean }>): ReplayDecision {
  if (!input.sameKey) return "NEW";
  return input.bindingMatches && input.intentMatches ? "SAFE_REPLAY" : "CONFLICT";
}
