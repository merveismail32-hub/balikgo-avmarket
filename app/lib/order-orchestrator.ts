import "server-only";

import { Prisma, type OrderStatus } from "@prisma/client";
import { enqueueNotifications, type NotificationDraft } from "./notifications";
import { aggregateOrderStatus, cancellationLedgerReversals, pendingRefundPaymentStatus } from "./order-invariants";
import { restoreCancellation } from "./stock-truth";

type CancellationActor = { kind: "CUSTOMER"; userId: string } | { kind: "SELLER"; userId: string; sellerId: string };

async function refreshAggregateOrderStatus(tx: Prisma.TransactionClient, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { status: true } });
  const status = aggregateOrderStatus(items.map((item) => item.status));
  await tx.order.update({ where: { id: orderId }, data: { status } });
  return status;
}

export async function reconcileOrderPayouts(tx: Prisma.TransactionClient, orderId: string) {
  const payment = await tx.payment.findUnique({ where: { orderId }, select: { status: true } });
  if (payment?.status !== "PAID") return 0;
  const changed = await tx.sellerPayout.updateMany({
    where: { orderId, status: "PENDING", orderItem: { status: { in: ["DELIVERED", "COMPLETED"] }, refunds: { none: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED"] } } } } },
    data: { status: "AVAILABLE", availableAt: new Date() },
  });
  return changed.count;
}

export async function synchronizePaymentRefundStatus(tx: Prisma.TransactionClient, paymentId: string) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { amount: true, status: true } });
  if (payment.status !== "PAID" && payment.status !== "REFUND_PENDING" && payment.status !== "PARTIAL_REFUND_PENDING") return payment.status;
  const totals = await tx.refund.aggregate({ where: { paymentId, status: { in: ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED"] } }, _sum: { amount: true } });
  const refundTotal = totals._sum.amount ?? new Prisma.Decimal(0);
  if (refundTotal.isZero()) {
    if (payment.status === "REFUND_PENDING" || payment.status === "PARTIAL_REFUND_PENDING") await tx.payment.update({ where: { id: paymentId }, data: { status: "PAID" } });
    return "PAID" as const;
  }
  const status = pendingRefundPaymentStatus(refundTotal, payment.amount);
  await tx.payment.update({ where: { id: paymentId }, data: { status } });
  return status;
}

export async function ensurePaidCancellationIntegrity(tx: Prisma.TransactionClient, orderId: string) {
  const payment = await tx.payment.findUnique({ where: { orderId }, select: { id: true, status: true, order: { select: { userId: true, orderNumber: true } } } });
  if (payment?.status !== "PAID") return 0;
  const items = await tx.orderItem.findMany({ where: { orderId, status: "CANCELLED" }, select: { id: true, sellerId: true, unitPrice: true, quantity: true, discountAmount: true, commissionAmount: true, payout: { select: { id: true } } } });
  for (const item of items) {
    const amount = item.unitPrice.mul(item.quantity).minus(item.discountAmount).toDecimalPlaces(2);
    const refund = await tx.refund.upsert({ where: { idempotencyKey: `cancellation:${item.id}` }, update: {}, create: { paymentId: payment.id, orderId, orderItemId: item.id, sellerId: item.sellerId, idempotencyKey: `cancellation:${item.id}`, amount, reason: "Ödeme doğrulanmadan önce iptal edilen sipariş kalemi", status: "REQUESTED" } });
    await tx.financialLedgerEntry.createMany({ data: cancellationLedgerReversals({ sellerId: item.sellerId, orderItemId: item.id, payoutId: item.payout?.id, refundId: refund.id, grossAmount: amount, commissionAmount: item.commissionAmount ?? new Prisma.Decimal(0) }), skipDuplicates: true });
    await tx.financialAuditEvent.upsert({ where: { source_externalEventId: { source: "GUARDIAN", externalEventId: `late-payment-cancel:${item.id}` } }, update: {}, create: { paymentId: payment.id, refundId: refund.id, orderId, entityType: "REFUND", entityId: refund.id, eventType: "CANCELLATION_REFUND_REQUESTED", toStatus: "REQUESTED", source: "GUARDIAN", externalEventId: `late-payment-cancel:${item.id}` } });
    await enqueueNotifications(tx, [{ userId: payment.order.userId, orderId, type: "REFUND_REQUESTED", dedupeKey: `late-payment-cancel:${item.id}:customer`, title: "İade süreci başlatıldı", message: `${payment.order.orderNumber} numaralı siparişinizde iptal edilen kalem için ödeme iadesi beklemeye alındı.` }]);
  }
  if (items.length) await synchronizePaymentRefundStatus(tx, payment.id);
  return items.length;
}

export async function cancelOrderItem(tx: Prisma.TransactionClient, input: { orderItemId: string; actor: CancellationActor; reason?: string }) {
  const ownership = input.actor.kind === "CUSTOMER" ? { order: { userId: input.actor.userId } } : { sellerId: input.actor.sellerId };
  const item = await tx.orderItem.findFirst({
    where: { id: input.orderItemId, ...ownership },
    select: { id: true, orderId: true, sellerId: true, productId: true, sellerOfferId: true, productName: true, quantity: true, unitPrice: true, discountAmount: true, commissionAmount: true, status: true, payout: { select: { id: true } }, order: { select: { userId: true, orderNumber: true, payment: { select: { id: true, amount: true, status: true } } } } },
  });
  if (!item) return null;
  if (item.status === "CANCELLED") return { status: "CANCELLED" as const, idempotent: true };
  if (item.status !== "NEW" && item.status !== "PREPARING") throw new Error("INVALID_STATE");
  const changed = await tx.orderItem.updateMany({ where: { id: item.id, status: item.status, ...ownership }, data: { status: "CANCELLED" } });
  if (!changed.count) {
    const latest = await tx.orderItem.findFirst({ where: { id: item.id, ...ownership }, select: { status: true } });
    if (latest?.status === "CANCELLED") return { status: "CANCELLED" as const, idempotent: true };
    throw new Error("CONCURRENT_CHANGE");
  }

  if (item.sellerOfferId) {
    await restoreCancellation(tx, { sellerOfferId: item.sellerOfferId, productId: item.productId, quantity: item.quantity, orderId: item.orderId, orderItemId: item.id, actorUserId: input.actor.userId, actorSellerId: input.actor.kind === "SELLER" ? input.actor.sellerId : undefined, idempotencyKey: `stock:v1:cancellation:${item.id}`, source: input.actor.kind });
  } else await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
  await tx.sellerPayout.updateMany({ where: { orderItemId: item.id, status: { in: ["PENDING", "BLOCKED", "AVAILABLE", "SCHEDULED"] } }, data: { status: "CANCELLED", availableAt: null } });

  let refundId: string | null = null;
  const payment = item.order.payment;
  if (payment?.status === "PAID" || payment?.status === "PARTIAL_REFUND_PENDING" || payment?.status === "REFUND_PENDING") {
    const amount = item.unitPrice.mul(item.quantity).minus(item.discountAmount).toDecimalPlaces(2);
    const refund = await tx.refund.upsert({ where: { idempotencyKey: `cancellation:${item.id}` }, update: {}, create: { paymentId: payment.id, orderId: item.orderId, orderItemId: item.id, sellerId: item.sellerId, requestedByUserId: input.actor.userId, idempotencyKey: `cancellation:${item.id}`, amount, reason: input.reason?.trim() || `${input.actor.kind === "CUSTOMER" ? "Müşteri" : "Satıcı"} sipariş iptali`, status: "REQUESTED" } });
    refundId = refund.id;
    await tx.financialLedgerEntry.createMany({ data: cancellationLedgerReversals({ sellerId: item.sellerId, orderItemId: item.id, payoutId: item.payout?.id, refundId: refund.id, grossAmount: amount, commissionAmount: item.commissionAmount ?? new Prisma.Decimal(0) }), skipDuplicates: true });
    await synchronizePaymentRefundStatus(tx, payment.id);
  }

  await tx.orderStatusHistory.create({ data: { orderItemId: item.id, changedByUserId: input.actor.userId, fromStatus: item.status, toStatus: "CANCELLED" } });
  await tx.financialAuditEvent.create({ data: { paymentId: payment?.id, refundId, orderId: item.orderId, actorUserId: input.actor.userId, entityType: "ORDER_ITEM", entityId: item.id, eventType: `${input.actor.kind}_CANCELLED`, fromStatus: item.status, toStatus: "CANCELLED", source: input.actor.kind, externalEventId: `cancel:${item.id}` } });
  const notification: NotificationDraft = input.actor.kind === "CUSTOMER"
    ? { sellerId: item.sellerId, orderId: item.orderId, type: "ORDER_CANCELLED", dedupeKey: `cancel:${item.id}:seller`, title: "Sipariş kalemi iptal edildi", message: `${item.order.orderNumber} siparişindeki ${item.productName} müşteri tarafından iptal edildi.` }
    : { userId: item.order.userId, orderId: item.orderId, type: "ORDER_CANCELLED", dedupeKey: `cancel:${item.id}:customer`, title: "Sipariş kalemi iptal edildi", message: `${item.order.orderNumber} siparişindeki ${item.productName} satıcı tarafından iptal edildi.` };
  await enqueueNotifications(tx, [notification]);
  await refreshAggregateOrderStatus(tx, item.orderId);
  return { status: "CANCELLED" as const, idempotent: false, refundId };
}

export async function transitionOrderItem(tx: Prisma.TransactionClient, input: { orderItemId: string; sellerId: string; actorUserId: string; target: Exclude<OrderStatus, "CANCELLED" | "RETURN_REQUESTED" | "RETURNED">; allowedFrom: OrderStatus[]; shippingCompany?: string; trackingNumber?: string; notification?: NotificationDraft }) {
  const item = await tx.orderItem.findFirst({ where: { id: input.orderItemId, sellerId: input.sellerId }, select: { id: true, orderId: true, status: true } });
  if (!item) return null;
  if (item.status === input.target) return { status: input.target, idempotent: true };
  if (!input.allowedFrom.includes(item.status)) throw new Error("INVALID_TRANSITION");
  const changed = await tx.orderItem.updateMany({ where: { id: item.id, sellerId: input.sellerId, status: item.status }, data: { status: input.target, ...(input.target === "SHIPPED" ? { shippingCompany: input.shippingCompany, trackingNumber: input.trackingNumber } : {}) } });
  if (!changed.count) throw new Error("CONCURRENT_CHANGE");
  await tx.orderStatusHistory.create({ data: { orderItemId: item.id, changedByUserId: input.actorUserId, fromStatus: item.status, toStatus: input.target } });
  if (input.target === "DELIVERED") await reconcileOrderPayouts(tx, item.orderId);
  if (input.notification) await enqueueNotifications(tx, [input.notification]);
  await refreshAggregateOrderStatus(tx, item.orderId);
  return { status: input.target, idempotent: false };
}
