import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type PaymentReconciliationPriority, type PaymentReconciliationReason, type PaymentStatus } from "@prisma/client";
import { enqueueNotifications } from "./notifications";

export function paymentReconciliationFingerprint(input: { paymentId: string; reason: PaymentReconciliationReason; terminalStatus: PaymentStatus }) {
  return createHash("sha256").update(JSON.stringify(["payment-reconciliation:v1", input.paymentId, input.reason, input.terminalStatus])).digest("hex");
}

const select = { id: true, paymentId: true, reason: true, terminalStatus: true, status: true, priority: true, fingerprint: true, openFingerprint: true } as const;

function isOpenFingerprintConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && JSON.stringify(error.meta ?? "").includes("openFingerprint");
}

export async function createOrGetPaymentReconciliationReview(tx: Prisma.TransactionClient, input: { paymentId: string; paymentEventId?: string; reason: PaymentReconciliationReason; terminalStatus: PaymentStatus; priority?: PaymentReconciliationPriority; metadata?: Prisma.InputJsonValue }) {
  const fingerprint = paymentReconciliationFingerprint(input);
  const existing = await tx.paymentReconciliationReview.findUnique({ where: { openFingerprint: fingerprint }, select });
  if (existing) return { review: existing, created: false };
  try {
    const review = await tx.paymentReconciliationReview.create({ data: { paymentId: input.paymentId, paymentEventId: input.paymentEventId, reason: input.reason, terminalStatus: input.terminalStatus, priority: input.priority ?? "HIGH", fingerprint, openFingerprint: fingerprint, metadata: input.metadata }, select });
    return { review, created: true };
  } catch (error) {
    if (!isOpenFingerprintConflict(error)) throw error;
    const review = await tx.paymentReconciliationReview.findUnique({ where: { openFingerprint: fingerprint }, select });
    if (!review) throw error;
    return { review, created: false };
  }
}

export function closePaymentReconciliationReviewData(review: { status: "PENDING" | "RESOLVED" | "REJECTED" }, target: "RESOLVED" | "REJECTED", resolverUserId: string) {
  if (review.status !== "PENDING") throw new Error("PAYMENT_RECONCILIATION_REVIEW_ALREADY_CLOSED");
  return { status: target, openFingerprint: null, resolvedAt: new Date(), resolvedByUserId: resolverUserId } as const;
}

export async function enqueuePaymentReconciliationAlerts(tx: Prisma.TransactionClient, input: { reviewId: string; orderId: string; type: string; title: string; message: string }) {
  const admins = await tx.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  await enqueueNotifications(tx, admins.map((admin) => ({ userId: admin.id, orderId: input.orderId, type: input.type, dedupeKey: `payment-reconciliation:${input.reviewId}:admin:${admin.id}`, title: input.title, message: input.message })));
}
