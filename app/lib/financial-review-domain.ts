import type { FinancialVerificationStatus } from "@prisma/client";

export type FinancialReviewDecision = "APPROVE" | "REJECT";

export class FinancialReviewError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "STALE_CONTEXT" | "INVALID_STATE" | "IDEMPOTENCY_CONFLICT", message: string) {
    super(message);
    this.name = "FinancialReviewError";
  }
}

export function canReviewFinancialIdentity(user: { role: string; financialIdentityReviewerEnabled: boolean } | null | undefined) {
  return user?.role === "ADMIN" && user.financialIdentityReviewerEnabled === true;
}

export function assertFinancialReviewTransition(current: FinancialVerificationStatus, decision: FinancialReviewDecision) {
  if (!["UNVERIFIED", "PENDING", "NEEDS_REVIEW"].includes(current)) {
    throw new FinancialReviewError("INVALID_STATE", "Finansal doğrulama kararı mevcut durumda değiştirilemez.");
  }
  return decision === "APPROVE" ? "VERIFIED" as const : "REJECTED" as const;
}

export function validateManualReviewIntent(input: { decision: FinancialReviewDecision; reasonCode: string; evidenceReference: string; idempotencyKey: string }) {
  const reasonCode = input.reasonCode.trim();
  const evidenceReference = input.evidenceReference.trim();
  if (!reasonCode || reasonCode.length > 80 || !/^[A-Z0-9_:-]+$/.test(reasonCode)) throw new FinancialReviewError("INVALID_INPUT", "Güvenli karar nedeni zorunludur.");
  if (!evidenceReference || evidenceReference.length > 500) throw new FinancialReviewError("INVALID_INPUT", "Kanıt referansı zorunludur.");
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 181) throw new FinancialReviewError("INVALID_INPUT", "Idempotency anahtarı geçersiz.");
  return { decision: input.decision, reasonCode, evidenceReference, idempotencyKey: input.idempotencyKey };
}

export function manualDecisionMarker(decision: FinancialReviewDecision, reasonCode: string) {
  return `MANUAL_${decision}:${reasonCode}`;
}
