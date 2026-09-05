import { isSafeReasonCode } from "./trust-primitives";

export type SafeTrustAuthenticity = "AUTHENTICATED" | "UNAUTHENTICATED" | "NOT_APPLICABLE";

export type SafeTrustInvalidation = Readonly<{
  stale: boolean;
  revoked: boolean;
  expired: boolean;
  superseded: boolean;
}>;

export type SafeTrustView<
  Outcome extends string,
  SourceCategory extends string,
  ReasonCode extends string,
> = Readonly<{
  outcome: Outcome;
  source: Readonly<{ category: SourceCategory; authenticity: SafeTrustAuthenticity }>;
  trusted: boolean;
  current: boolean;
  applicable: boolean;
  reasonCodes: readonly ReasonCode[];
  invalidation: SafeTrustInvalidation;
  observedAt: string | null;
  verifiedAt: string | null;
  changedAt: string | null;
  subjectSummary?: string;
}>;

export function safeTimestamp(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function safeReasonCodes<ReasonCode extends string>(reasonCodes: readonly ReasonCode[]): readonly ReasonCode[] {
  return reasonCodes.filter(isSafeReasonCode);
}

export function safeMaskedSubject(value: string | null | undefined): string | undefined {
  if (!value || value.length > 80 || !value.includes("•") || !/^[\p{L}\d• *_-]+$/u.test(value)) return undefined;
  return (value.match(/\d/g)?.length ?? 0) <= 4 ? value : undefined;
}

export type TrustTelemetryDomain = "FINANCE" | "PAYMENT" | "SHIPMENT" | "CATALOG";
export type TrustTelemetryResult = "ALLOWED" | "DENIED";

export type TrustTelemetryDescriptor = Readonly<{
  event: "TRUST_EVALUATED";
  domain: TrustTelemetryDomain;
  category: string;
  result: TrustTelemetryResult;
  trusted: boolean;
  current: boolean;
  applicable: boolean;
  reasonCodes: readonly string[];
  occurredAt: string;
  correlationReference: string | null;
}>;

function safeToken(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength && /^[A-Z0-9][A-Z0-9_:-]*$/.test(value);
}

export function toTrustTelemetryDescriptor(input: Readonly<{
  domain: TrustTelemetryDomain;
  category: string;
  trusted: boolean;
  current: boolean;
  applicable: boolean;
  reasonCodes: readonly string[];
  occurredAt: Date;
  correlationReference?: string | null;
}>): TrustTelemetryDescriptor {
  const occurredAt = safeTimestamp(input.occurredAt);
  if (!safeToken(input.category, 80) || !occurredAt) throw new Error("Unsafe trust telemetry metadata");
  const correlationReference = input.correlationReference && safeToken(input.correlationReference, 191)
    ? input.correlationReference
    : null;
  return Object.freeze({
    event: "TRUST_EVALUATED",
    domain: input.domain,
    category: input.category,
    result: input.applicable ? "ALLOWED" : "DENIED",
    trusted: input.trusted,
    current: input.current,
    applicable: input.applicable,
    reasonCodes: Object.freeze([...safeReasonCodes(input.reasonCodes)]),
    occurredAt,
    correlationReference,
  });
}
