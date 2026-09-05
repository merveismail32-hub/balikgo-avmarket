import { classifyReplay, compareTrustBinding, isSafeReasonCode, type ReplayDecision, type TrustBinding, type TrustBindingPart } from "./trust-primitives";
import { safeReasonCodes, safeTimestamp, type SafeTrustView } from "./safe-trust-read-model";

export type ProviderResultSemantics = "POSITIVE" | "NEGATIVE" | "UNKNOWN";

export type ProviderIdentity = Readonly<{
  provider: string;
  accountReference: string;
  environment: string;
}>;

export type ProviderEvidenceReference = Readonly<{
  externalEventId: string;
  reference: string;
  verificationMethod: string;
  receivedAt: Date;
  decidedAt?: Date | null;
}>;

const adapterBrand: unique symbol = Symbol("ProviderTrustAdapter");

export type ProviderTrustAdapter<Message> = Readonly<{
  [adapterBrand]: true;
  authenticate(message: Message): boolean;
  normalizeResult(message: Message): ProviderResultSemantics;
}>;

export function defineProviderTrustAdapter<Message>(adapter: Readonly<{
  authenticate(message: Message): boolean;
  normalizeResult(message: Message): ProviderResultSemantics;
}>): ProviderTrustAdapter<Message> {
  return Object.freeze({ ...adapter, [adapterBrand]: true as const });
}

export type ProviderBoundaryReasonCode =
  | "SOURCE_UNAUTHENTICATED"
  | "EVIDENCE_MISSING"
  | "PROVIDER_MISMATCH"
  | "ACCOUNT_MISMATCH"
  | "ENVIRONMENT_MISMATCH"
  | "BINDING_MISMATCH"
  | "PROVIDER_RESULT_NEGATIVE"
  | "PROVIDER_RESULT_UNKNOWN"
  | "REPLAY_CONFLICT";

export type ProviderBoundaryDecision = Readonly<{
  authenticated: boolean;
  result: ProviderResultSemantics;
  identityMatches: boolean;
  bindingMatches: boolean;
  evidencePresent: boolean;
  replay: ReplayDecision;
  readyForDomainEvaluation: boolean;
  reasonCodes: readonly ProviderBoundaryReasonCode[];
  provenance: Readonly<{
    provider: string;
    accountReference: string;
    environment: string;
    externalEventId: string | null;
    reference: string | null;
    verificationMethod: string | null;
    receivedAt: string | null;
    decidedAt: string | null;
  }>;
}>;

type PriorEvent<Parts extends readonly TrustBindingPart[]> = Readonly<{
  externalEventId: string;
  binding: TrustBinding<Parts>;
  intent: string;
}>;

function present(value: string, max: number) {
  return value.length > 0 && value.length <= max && /^[A-Za-z0-9._:/-]+$/.test(value);
}

function validEvidence(evidence: ProviderEvidenceReference | null | undefined) {
  return !!evidence
    && present(evidence.externalEventId, 191)
    && present(evidence.reference, 500)
    && isSafeReasonCode(evidence.verificationMethod)
    && !Number.isNaN(evidence.receivedAt.getTime())
    && (!evidence.decidedAt || !Number.isNaN(evidence.decidedAt.getTime()));
}

export function evaluateProviderBoundary<Message, Parts extends readonly TrustBindingPart[]>(input: Readonly<{
  adapter: ProviderTrustAdapter<Message>;
  message: Message;
  expectedIdentity: ProviderIdentity;
  observedIdentity: ProviderIdentity;
  expectedBinding: TrustBinding<Parts>;
  observedBinding: TrustBinding<Parts>;
  intent: string;
  evidence?: ProviderEvidenceReference | null;
  priorEvent?: PriorEvent<Parts> | null;
}>): ProviderBoundaryDecision {
  const adapterDefined = input.adapter?.[adapterBrand] === true;
  let authenticated = false;
  let result: ProviderResultSemantics = "UNKNOWN";
  if (adapterDefined) {
    try { authenticated = input.adapter.authenticate(input.message) === true; } catch { authenticated = false; }
    try {
      const normalized = input.adapter.normalizeResult(input.message);
      result = normalized === "POSITIVE" || normalized === "NEGATIVE" || normalized === "UNKNOWN" ? normalized : "UNKNOWN";
    } catch { result = "UNKNOWN"; }
  }
  const providerMatches = present(input.expectedIdentity.provider, 80) && present(input.observedIdentity.provider, 80) && input.expectedIdentity.provider === input.observedIdentity.provider;
  const accountMatches = present(input.expectedIdentity.accountReference, 191) && present(input.observedIdentity.accountReference, 191) && input.expectedIdentity.accountReference === input.observedIdentity.accountReference;
  const environmentMatches = present(input.expectedIdentity.environment, 40) && present(input.observedIdentity.environment, 40) && input.expectedIdentity.environment === input.observedIdentity.environment;
  const identityMatches = providerMatches && accountMatches && environmentMatches;
  const bindingMatches = isSafeReasonCode(input.intent) && compareTrustBinding(input.expectedBinding, input.observedBinding);
  const evidencePresent = validEvidence(input.evidence);
  const sameEvent = evidencePresent && !!input.priorEvent && input.evidence!.externalEventId === input.priorEvent.externalEventId;
  const replay = classifyReplay({
    sameKey: sameEvent,
    bindingMatches: !sameEvent || compareTrustBinding(input.priorEvent!.binding, input.observedBinding),
    intentMatches: !sameEvent || input.priorEvent!.intent === input.intent,
  });
  const reasonCodes: ProviderBoundaryReasonCode[] = [];
  if (!authenticated) reasonCodes.push("SOURCE_UNAUTHENTICATED");
  if (!evidencePresent) reasonCodes.push("EVIDENCE_MISSING");
  if (!providerMatches) reasonCodes.push("PROVIDER_MISMATCH");
  if (!accountMatches) reasonCodes.push("ACCOUNT_MISMATCH");
  if (!environmentMatches) reasonCodes.push("ENVIRONMENT_MISMATCH");
  if (!bindingMatches) reasonCodes.push("BINDING_MISMATCH");
  if (result === "NEGATIVE") reasonCodes.push("PROVIDER_RESULT_NEGATIVE");
  if (result === "UNKNOWN") reasonCodes.push("PROVIDER_RESULT_UNKNOWN");
  if (replay === "CONFLICT") reasonCodes.push("REPLAY_CONFLICT");
  return {
    authenticated,
    result,
    identityMatches,
    bindingMatches,
    evidencePresent,
    replay,
    readyForDomainEvaluation: reasonCodes.length === 0,
    reasonCodes,
    provenance: {
      provider: input.observedIdentity.provider,
      accountReference: input.observedIdentity.accountReference,
      environment: input.observedIdentity.environment,
      externalEventId: evidencePresent ? input.evidence!.externalEventId : null,
      reference: evidencePresent ? input.evidence!.reference : null,
      verificationMethod: evidencePresent ? input.evidence!.verificationMethod : null,
      receivedAt: evidencePresent ? input.evidence!.receivedAt.toISOString() : null,
      decidedAt: evidencePresent && input.evidence!.decidedAt ? input.evidence!.decidedAt.toISOString() : null,
    },
  };
}

export type ProviderBoundarySafeView = SafeTrustView<ProviderResultSemantics, "EXTERNAL_PROVIDER", ProviderBoundaryReasonCode> & Readonly<{
  readyForDomainEvaluation: boolean;
  replay: ReplayDecision;
}>;

export function toProviderBoundarySafeView(decision: ProviderBoundaryDecision): ProviderBoundarySafeView {
  return {
    outcome: decision.result,
    source: {
      category: "EXTERNAL_PROVIDER",
      authenticity: decision.authenticated ? "AUTHENTICATED" : "UNAUTHENTICATED",
    },
    trusted: decision.authenticated && decision.evidencePresent && decision.identityMatches && decision.bindingMatches && decision.replay !== "CONFLICT",
    current: decision.bindingMatches && decision.replay !== "CONFLICT",
    applicable: false,
    readyForDomainEvaluation: decision.readyForDomainEvaluation,
    replay: decision.replay,
    reasonCodes: safeReasonCodes(decision.reasonCodes),
    invalidation: { stale: !decision.bindingMatches, revoked: false, expired: false, superseded: decision.replay === "CONFLICT" },
    observedAt: safeTimestamp(decision.provenance.receivedAt),
    verifiedAt: safeTimestamp(decision.provenance.decidedAt),
    changedAt: safeTimestamp(decision.provenance.decidedAt ?? decision.provenance.receivedAt),
  };
}
