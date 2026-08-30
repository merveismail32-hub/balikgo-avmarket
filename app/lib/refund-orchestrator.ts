import "server-only";

import { Prisma } from "@prisma/client";

export type RefundProviderResult = { outcome: "COMPLETED" | "FAILED" | "UNKNOWN"; providerRefundId?: string };
export interface PaymentRefundProvider { refund(input: { providerPaymentId: string; amount: string; currency: string; idempotencyKey: string }): Promise<RefundProviderResult>; }
type TransactionRunner = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

// Claim is local and short-lived. The network call belongs outside this transaction.
export async function claimRefundExecution(tx: Prisma.TransactionClient, refundId: string) {
  await tx.$queryRaw`SELECT id FROM "Refund" WHERE id = ${refundId} FOR UPDATE`;
  const refund = await tx.refund.findUnique({ where: { id: refundId }, include: { payment: { select: { providerPaymentId: true } } } });
  if (!refund) throw new Error("REFUND_NOT_FOUND");
  if (refund.status === "COMPLETED") return { refund, idempotent: true };
  if (refund.status === "PROCESSING") throw new Error("REFUND_ALREADY_PROCESSING");
  if (refund.status !== "APPROVED") throw new Error("REFUND_NOT_APPROVED");
  if (!refund.payment.providerPaymentId) throw new Error("REFUND_REQUIRES_REVIEW");
  const executionKey = `refund:${refund.id}`;
  await tx.refund.update({ where: { id: refund.id }, data: { status: "PROCESSING", executionKey } });
  return { refund: { ...refund, executionKey }, idempotent: false };
}

export async function finalizeRefundExecution(tx: Prisma.TransactionClient, input: { refundId: string; result: RefundProviderResult }) {
  await tx.$queryRaw`SELECT id FROM "Refund" WHERE id = ${input.refundId} FOR UPDATE`;
  const refund = await tx.refund.findUniqueOrThrow({ where: { id: input.refundId } });
  if (refund.status === "COMPLETED") return { status: "COMPLETED" as const, idempotent: true };
  if (refund.status !== "PROCESSING") throw new Error("REFUND_NOT_PROCESSING");
  // Unknown is intentionally retained as PROCESSING: retrying could double-refund.
  if (input.result.outcome === "UNKNOWN") {
    await tx.refund.update({ where: { id: refund.id }, data: { providerOutcome: "UNKNOWN", providerObservedAt: new Date() } });
    return { status: "PROCESSING" as const, requiresReview: true };
  }
  if (input.result.outcome === "FAILED") {
    await tx.refund.update({ where: { id: refund.id }, data: { status: "FAILED", providerOutcome: "FAILED", providerObservedAt: new Date() } });
    return { status: "FAILED" as const };
  }
  if (!input.result.providerRefundId) throw new Error("REFUND_PROVIDER_REFERENCE_REQUIRED");
  await tx.refund.update({ where: { id: refund.id }, data: { status: "COMPLETED", providerRefundId: input.result.providerRefundId, providerOutcome: "COMPLETED", providerObservedAt: new Date(), completedAt: new Date() } });
  return { status: "COMPLETED" as const };
}

// This composes the three authority boundaries without holding a DB transaction during I/O.
export async function executeClaimedRefund(input: { refundId: string; provider: PaymentRefundProvider; transaction: TransactionRunner }) {
  const claimed = await input.transaction((tx) => claimRefundExecution(tx, input.refundId));
  if (claimed.idempotent) return { status: "COMPLETED" as const, idempotent: true };
  let result: RefundProviderResult;
  try {
    result = await input.provider.refund({ providerPaymentId: claimed.refund.payment.providerPaymentId!, amount: claimed.refund.amount.toString(), currency: claimed.refund.currency, idempotencyKey: claimed.refund.executionKey! });
  } catch {
    result = { outcome: "UNKNOWN" };
  }
  return input.transaction((tx) => finalizeRefundExecution(tx, { refundId: input.refundId, result }));
}
