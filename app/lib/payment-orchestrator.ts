import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { paymentProviderMatches, type VerifiedPaymentEvent } from "./payments";
import { enqueueNotifications } from "./notifications";
import { ensurePaidCancellationIntegrity, reconcileOrderPayouts } from "./order-orchestrator";
import { consumeOrderReservationsForPayment, releaseOrderReservation } from "./stock-reservation";
import { createOrGetPaymentReconciliationReview, enqueuePaymentReconciliationAlerts } from "./payment-reconciliation";

export function isDuplicatePaymentEventConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002"
    && JSON.stringify(error.meta ?? "").includes("providerEventId");
}

type PaymentEventInput = { provider: string; event: VerifiedPaymentEvent; payloadHash?: string };

// Only verified events enter here. Retry the entire local transaction, never a partial mutation.
export async function processPaymentCallback(client: Pick<PrismaClient, "$transaction">, input: PaymentEventInput) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.$transaction((tx) => processVerifiedPaymentEvent(tx, input));
    } catch (error) {
      const retryable = isDuplicatePaymentEventConflict(error)
        || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034");
      if (!retryable || attempt >= 2) throw error;
    }
  }
}

export async function processVerifiedPaymentEvent(tx: Prisma.TransactionClient, input: PaymentEventInput) {
  if (!["PAYMENT_PAID", "PAYMENT_FAILED"].includes(input.event.eventType)) throw new Error("INVALID_PAYMENT_EVENT");
  // Serialize callbacks with each other and the expiry worker before reading lifecycle/stock truth.
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${input.event.paymentId} FOR UPDATE`;
  const payment = await tx.payment.findUnique({ where: { id: input.event.paymentId }, select: { id: true, orderId: true, amount: true, currency: true, status: true, provider: true, providerPaymentId: true, order: { select: { userId: true, orderNumber: true, items: { select: { sellerId: true, stockReservationState: true } } } } } });
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");
  if (!payment.amount.equals(new Prisma.Decimal(input.event.amount)) || payment.currency !== input.event.currency) throw new Error("AMOUNT_MISMATCH");
  if (!paymentProviderMatches(payment.provider, input.provider)) throw new Error("PAYMENT_MISMATCH");
  if (payment.providerPaymentId && input.event.providerPaymentId && payment.providerPaymentId !== input.event.providerPaymentId) throw new Error("PAYMENT_MISMATCH");
  const duplicate = await tx.paymentEvent.findUnique({ where: { provider_providerEventId: { provider: input.provider, providerEventId: input.event.eventId } }, select: { paymentId: true, eventType: true } });
  if (duplicate) {
    if (duplicate.paymentId !== payment.id || duplicate.eventType !== input.event.eventType) throw new Error("PAYMENT_EVENT_CONFLICT");
    return { duplicate: true };
  }
  const paymentEvent = await tx.paymentEvent.create({ data: { paymentId: payment.id, provider: input.provider, providerEventId: input.event.eventId, eventType: input.event.eventType, payloadHash: input.payloadHash } });
  const target = input.event.eventType === "PAYMENT_PAID" ? "PAID" : "FAILED";
  const releasedBeforePaid = target === "PAID" && ["PENDING", "AUTHORIZED"].includes(payment.status) && payment.order.items.some((item) => item.stockReservationState === "RELEASED");
  const changed = releasedBeforePaid ? { count: 0 } : await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "AUTHORIZED"] } }, data: { status: target, providerPaymentId: input.event.providerPaymentId, ...(target === "PAID" ? { paidAt: new Date() } : { failedAt: new Date() }) } });
  const current = changed.count ? target : (await tx.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true } })).status;
  const latePaid = !changed.count && target === "PAID" && (["FAILED", "EXPIRED", "CANCELLED"].includes(current) || releasedBeforePaid);
  const conflictingFailure = !changed.count && target === "FAILED" && ["PAID", "REFUND_PENDING", "PARTIAL_REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED"].includes(current);
  await tx.financialAuditEvent.create({ data: { paymentId: payment.id, orderId: payment.orderId, entityType: "PAYMENT", entityId: payment.id, eventType: latePaid ? "LATE_PAYMENT_REVIEW_REQUIRED" : input.event.eventType, fromStatus: payment.status, toStatus: current, source: `WEBHOOK_${input.provider}`, externalEventId: input.event.eventId } });
  if (changed.count && target === "PAID") {
    await consumeOrderReservationsForPayment(tx, payment.id);
    await ensurePaidCancellationIntegrity(tx, payment.orderId);
    await reconcileOrderPayouts(tx, payment.orderId);
    const sellerIds = [...new Set(payment.order.items.map((item) => item.sellerId))];
    await enqueueNotifications(tx, [{ userId: payment.order.userId, orderId: payment.orderId, type: "PAYMENT_PAID", dedupeKey: `payment-paid:${payment.id}:customer`, title: "Ödemeniz alındı", message: `${payment.order.orderNumber} numaralı siparişinizin ödemesi doğrulandı.` }, ...sellerIds.map((sellerId) => ({ sellerId, orderId: payment.orderId, type: "SELLER_NEW_ORDER", dedupeKey: `payment-paid:${payment.id}:seller:${sellerId}`, title: "Yeni sipariş", message: `${payment.order.orderNumber} numaralı siparişte mağazanıza ait ürünler bulunuyor.` }))]);
  }
  if (changed.count && target === "FAILED") {
    await releaseOrderReservation(tx, { paymentId: payment.id, reason: "PAYMENT_FAILED" });
    await tx.payment.update({ where: { id: payment.id }, data: { stockReleasedAt: new Date(), stockReleaseReason: "PAYMENT_FAILED" } });
    await enqueueNotifications(tx, [{ userId: payment.order.userId, orderId: payment.orderId, type: "PAYMENT_FAILED", dedupeKey: `payment-failed:${payment.id}:customer`, title: "Ödeme tamamlanamadı", message: `${payment.order.orderNumber} numaralı siparişiniz ödeme tamamlanamadığı için iptal edildi.` }]);
  }
  if (latePaid) {
    const review = await createOrGetPaymentReconciliationReview(tx, { paymentId: payment.id, paymentEventId: paymentEvent.id, reason: "LATE_PAYMENT_SUCCESS", terminalStatus: current, priority: "CRITICAL", metadata: { signal: "REFUND_REQUIRED", slaHours: 2 } });
    await enqueueNotifications(tx, [{ userId: payment.order.userId, orderId: payment.orderId, type: "LATE_PAYMENT_REVIEW_REQUIRED", dedupeKey: `late-payment-review:${review.review.id}:customer`, title: "Ödemeniz inceleniyor", message: `${payment.order.orderNumber} numaralı siparişiniz için geç ulaşan ödeme operasyon incelemesine alındı.` }]);
    await enqueuePaymentReconciliationAlerts(tx, { reviewId: review.review.id, orderId: payment.orderId, type: "CEO_LATE_PAYMENT_REVIEW", title: "Kritik ödeme incelemesi", message: "Geç ulaşan ödeme için iki saatlik operasyon incelemesi gereklidir." });
  }
  if (conflictingFailure) {
    const review = await createOrGetPaymentReconciliationReview(tx, { paymentId: payment.id, paymentEventId: paymentEvent.id, reason: "PAYMENT_STOCK_STATE_MISMATCH", terminalStatus: current, priority: "CRITICAL", metadata: { signal: "CONFLICTING_PROVIDER_EVENT", eventType: input.event.eventType, slaHours: 2 } });
    await enqueuePaymentReconciliationAlerts(tx, { reviewId: review.review.id, orderId: payment.orderId, type: "PAYMENT_EVENT_CONFLICT", title: "Çelişkili ödeme bildirimi", message: "Tamamlanan ödeme için başarısızlık bildirimi alındı; durum değiştirilmeden incelemeye yönlendirildi." });
  }
  return { duplicate: false, latePaymentReviewRequired: latePaid, reconciliationRequired: latePaid || conflictingFailure };
}
