import "server-only";

import { Prisma, type PaymentStatus } from "@prisma/client";
import type { ObservedProviderPayment } from "./payments";
import { createOrGetPaymentReconciliationReview } from "./payment-reconciliation";
import { parseProviderConfirmedInstallmentCount } from "./payments/provider-installment-consistency";
import { reconcileOrderRewardWithPayment } from "./reward-payment-lifecycle";
import { RewardDomainError } from "./reward-domain";

export type PaymentMismatchCategory =
  | "PROVIDER_SUCCESS_INTERNAL_PENDING" | "PROVIDER_SUCCESS_INTERNAL_FAILED" | "PROVIDER_SUCCESS_INTERNAL_EXPIRED"
  | "INTERNAL_PAID_PROVIDER_PENDING" | "INTERNAL_PAID_PROVIDER_FAILED" | "AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH" | "ORDER_IDENTITY_MISMATCH" | "PROVIDER_TRANSACTION_ID_MISMATCH"
  | "RESERVATION_STATE_MISMATCH" | "INSTALLMENT_COUNT_MISMATCH" | "UNKNOWN_PROVIDER_STATE";
export type ReconciliationDecision = "REPLAY_ORCHESTRATION" | "REQUIRE_MANUAL_REVIEW" | "NO_ACTION";
type InternalTruth = { status: PaymentStatus; amount: { equals(value: Prisma.Decimal): boolean }; currency: string; provider: string; providerPaymentId: string | null; selectedInstallmentCount?: number | null; providerConfirmedInstallmentCount?: number | null; orderId: string; order: { items: { stockReservationState: string | null }[] } };

export function classifyPaymentMismatch(payment: InternalTruth, observed: ObservedProviderPayment): { category?: PaymentMismatchCategory; decision: ReconciliationDecision } {
  if (observed.status === "UNKNOWN") return { category: "UNKNOWN_PROVIDER_STATE", decision: "REQUIRE_MANUAL_REVIEW" };
  if (observed.amount && !payment.amount.equals(new Prisma.Decimal(observed.amount))) return { category: "AMOUNT_MISMATCH", decision: "REQUIRE_MANUAL_REVIEW" };
  if (observed.currency && payment.currency !== observed.currency) return { category: "CURRENCY_MISMATCH", decision: "REQUIRE_MANUAL_REVIEW" };
  if (observed.orderId && payment.orderId !== observed.orderId) return { category: "ORDER_IDENTITY_MISMATCH", decision: "REQUIRE_MANUAL_REVIEW" };
  if (observed.providerPaymentId && payment.providerPaymentId && payment.providerPaymentId !== observed.providerPaymentId) return { category: "PROVIDER_TRANSACTION_ID_MISMATCH", decision: "REQUIRE_MANUAL_REVIEW" };
  if (observed.providerConfirmedInstallmentCount !== undefined) {
    const confirmed = parseProviderConfirmedInstallmentCount(observed.providerConfirmedInstallmentCount);
    if ((payment.providerConfirmedInstallmentCount !== null && payment.providerConfirmedInstallmentCount !== undefined && payment.providerConfirmedInstallmentCount !== confirmed)
      || (payment.selectedInstallmentCount !== null && payment.selectedInstallmentCount !== undefined && payment.selectedInstallmentCount !== confirmed)) {
      return { category: "INSTALLMENT_COUNT_MISMATCH", decision: "REQUIRE_MANUAL_REVIEW" };
    }
  }
  const released = payment.order.items.some((item) => item.stockReservationState === "RELEASED");
  if (observed.status === "SUCCEEDED") {
    if (["FAILED", "CANCELLED"].includes(payment.status)) return { category: "PROVIDER_SUCCESS_INTERNAL_FAILED", decision: "REQUIRE_MANUAL_REVIEW" };
    if (payment.status === "EXPIRED") return { category: "PROVIDER_SUCCESS_INTERNAL_EXPIRED", decision: "REQUIRE_MANUAL_REVIEW" };
    if (["PENDING", "AUTHORIZED"].includes(payment.status)) return released ? { category: "RESERVATION_STATE_MISMATCH", decision: "REQUIRE_MANUAL_REVIEW" } : { category: "PROVIDER_SUCCESS_INTERNAL_PENDING", decision: "REPLAY_ORCHESTRATION" };
  }
  if (payment.status === "PAID" && observed.status === "FAILED") return { category: "INTERNAL_PAID_PROVIDER_FAILED", decision: "REQUIRE_MANUAL_REVIEW" };
  if (payment.status === "PAID" && observed.status === "PENDING") return { category: "INTERNAL_PAID_PROVIDER_PENDING", decision: "REQUIRE_MANUAL_REVIEW" };
  return { decision: "NO_ACTION" };
}

export async function detectPaymentReconciliation(tx: Prisma.TransactionClient, input: { paymentId: string; observed: ObservedProviderPayment; detectedBy: string }) {
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${input.paymentId} FOR UPDATE`;
  const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { id: true, orderId: true, status: true, amount: true, currency: true, provider: true, providerPaymentId: true, selectedInstallmentCount: true, providerConfirmedInstallmentCount: true, order: { select: { userId: true, items: { select: { stockReservationState: true } } } } } });
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");
  const result = classifyPaymentMismatch(payment, input.observed);
  if (input.observed.providerConfirmedInstallmentCount !== undefined && payment.providerConfirmedInstallmentCount === null) {
    await tx.payment.update({ where: { id: payment.id }, data: { providerConfirmedInstallmentCount: parseProviderConfirmedInstallmentCount(input.observed.providerConfirmedInstallmentCount) } });
  }
  const rewardEvidenceMatches = (input.observed.status === "SUCCEEDED" && ["PAID", "REFUND_PENDING", "PARTIAL_REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status))
    || (input.observed.status === "FAILED" && ["FAILED", "EXPIRED", "CANCELLED"].includes(payment.status));
  if (!result.category && rewardEvidenceMatches) {
    try {
      const reward = await reconcileOrderRewardWithPayment(tx, { paymentId: payment.id, eventIdentity: `reconciliation:${payment.id}:${input.observed.status}`, effectiveAt: input.observed.observedAt });
      return { ...result, payment, reward };
    } catch (error) {
      if (!(error instanceof RewardDomainError) || error.code !== "REWARD_TERMINAL_CONFLICT") throw error;
      const review = await createOrGetPaymentReconciliationReview(tx, { paymentId: payment.id, reason: "PAYMENT_STOCK_STATE_MISMATCH", terminalStatus: payment.status, mismatchCategory: "REWARD_TERMINAL_CONFLICT", priority: "CRITICAL", metadata: { detectedBy: input.detectedBy, observedStatus: input.observed.status, signal: "REWARD_TERMINAL_CONFLICT" } });
      if (review.created) await tx.financialAuditEvent.create({ data: { paymentId: payment.id, orderId: payment.orderId, entityType: "PAYMENT", entityId: payment.id, eventType: "PAYMENT_RECONCILIATION_DETECTED", fromStatus: payment.status, toStatus: payment.status, source: input.detectedBy, externalEventId: `reconciliation:${review.review.id}` } });
      return { category: "REWARD_TERMINAL_CONFLICT" as const, decision: "REQUIRE_MANUAL_REVIEW" as const, payment, review };
    }
  }
  if (!result.category || result.decision === "REPLAY_ORCHESTRATION") return { ...result, payment };
  const reason = result.category === "INSTALLMENT_COUNT_MISMATCH"
    ? "INSTALLMENT_COUNT_MISMATCH"
    : result.category.startsWith("PROVIDER_SUCCESS_INTERNAL") ? "LATE_PAYMENT_SUCCESS" : "PAYMENT_STOCK_STATE_MISMATCH" as const;
  const review = await createOrGetPaymentReconciliationReview(tx, { paymentId: payment.id, reason, terminalStatus: payment.status, mismatchCategory: result.category, priority: "CRITICAL", metadata: { detectedBy: input.detectedBy, observedStatus: input.observed.status, observedAt: (input.observed.observedAt ?? new Date()).toISOString(), providerPaymentId: input.observed.providerPaymentId, decision: result.decision } });
  if (review.created) await tx.financialAuditEvent.create({ data: { paymentId: payment.id, orderId: payment.orderId, entityType: "PAYMENT", entityId: payment.id, eventType: "PAYMENT_RECONCILIATION_DETECTED", fromStatus: payment.status, toStatus: payment.status, source: input.detectedBy, externalEventId: `reconciliation:${review.review.id}` } });
  return { ...result, payment, review };
}
