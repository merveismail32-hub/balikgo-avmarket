import "server-only";

import { Prisma } from "@prisma/client";
import type { VerifiedPaymentEvent } from "./payments";
import { enqueueNotifications } from "./notifications";
import { ensurePaidCancellationIntegrity, reconcileOrderPayouts } from "./order-orchestrator";

export function isDuplicatePaymentEventConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002"
    && JSON.stringify(error.meta ?? "").includes("providerEventId");
}

export async function processVerifiedPaymentEvent(tx: Prisma.TransactionClient, input: { provider: string; event: VerifiedPaymentEvent; payloadHash?: string }) {
  const duplicate = await tx.paymentEvent.findUnique({ where: { provider_providerEventId: { provider: input.provider, providerEventId: input.event.eventId } }, select: { id: true } });
  if (duplicate) return { duplicate: true };
  const payment = await tx.payment.findUnique({ where: { id: input.event.paymentId }, select: { id: true, orderId: true, amount: true, currency: true, status: true, provider: true, providerPaymentId: true, order: { select: { userId: true, orderNumber: true, items: { select: { sellerId: true } } } } } });
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");
  if (!payment.amount.equals(new Prisma.Decimal(input.event.amount)) || payment.currency !== input.event.currency) throw new Error("AMOUNT_MISMATCH");
  if (payment.provider !== input.provider && !(input.provider === "TEST" && payment.provider === "TEST_PENDING")) throw new Error("PAYMENT_MISMATCH");
  if (payment.providerPaymentId && input.event.providerPaymentId && payment.providerPaymentId !== input.event.providerPaymentId) throw new Error("PAYMENT_MISMATCH");
  await tx.paymentEvent.create({ data: { paymentId: payment.id, provider: input.provider, providerEventId: input.event.eventId, eventType: input.event.eventType, payloadHash: input.payloadHash } });
  const target = input.event.eventType === "PAYMENT_PAID" ? "PAID" : "FAILED";
  const changed = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "AUTHORIZED"] } }, data: { status: target, providerPaymentId: input.event.providerPaymentId, ...(target === "PAID" ? { paidAt: new Date() } : { failedAt: new Date() }) } });
  await tx.financialAuditEvent.create({ data: { paymentId: payment.id, orderId: payment.orderId, entityType: "PAYMENT", entityId: payment.id, eventType: input.event.eventType, fromStatus: payment.status, toStatus: changed.count ? target : payment.status, source: `WEBHOOK_${input.provider}`, externalEventId: input.event.eventId } });
  if (changed.count && target === "PAID") {
    await ensurePaidCancellationIntegrity(tx, payment.orderId);
    await reconcileOrderPayouts(tx, payment.orderId);
    const sellerIds = [...new Set(payment.order.items.map((item) => item.sellerId))];
    await enqueueNotifications(tx, [{ userId: payment.order.userId, orderId: payment.orderId, type: "PAYMENT_PAID", dedupeKey: `payment-paid:${payment.id}:customer`, title: "Ödemeniz alındı", message: `${payment.order.orderNumber} numaralı siparişinizin ödemesi doğrulandı.` }, ...sellerIds.map((sellerId) => ({ sellerId, orderId: payment.orderId, type: "SELLER_NEW_ORDER", dedupeKey: `payment-paid:${payment.id}:seller:${sellerId}`, title: "Yeni sipariş", message: `${payment.order.orderNumber} numaralı siparişte mağazanıza ait ürünler bulunuyor.` }))]);
  }
  return { duplicate: false };
}
