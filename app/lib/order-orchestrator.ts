import "server-only";

import { Prisma, type OrderStatus } from "@prisma/client";
import { enqueueNotifications, type NotificationDraft } from "./notifications";
import { cancellationLedgerReversals, isPaymentEligibleForFulfillment, pendingRefundPaymentStatus } from "./order-invariants";
import { releaseOrderItemReservation } from "./stock-reservation";
import { evaluateCancellationEligibility, isPreHandoffShipmentStatus } from "./cancellation-eligibility";
import { reconcileOrderAggregate } from "./order-reconciliation";

type CancellationActor = { kind: "CUSTOMER"; userId: string } | { kind: "SELLER"; userId: string; sellerId: string };

export async function assertPaymentPaidForFulfillment(tx: Prisma.TransactionClient, orderId: string) {
  const payment = await tx.payment.findUnique({ where: { orderId }, select: { status: true } });
  if (!payment || !isPaymentEligibleForFulfillment(payment.status)) throw new Error("PAYMENT_NOT_PAID");
}

export async function reconcileOrderPayouts(tx: Prisma.TransactionClient, orderId: string) {
  const payment = await tx.payment.findUnique({ where: { orderId }, select: { status: true } });
  if (!payment || !isPaymentEligibleForFulfillment(payment.status)) return 0;
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
  let item = await tx.orderItem.findFirst({
    where: { id: input.orderItemId, ...ownership },
    select: { id: true, orderId: true, sellerId: true, productId: true, sellerOfferId: true, productName: true, quantity: true, unitPrice: true, discountAmount: true, commissionAmount: true, status: true, stockReservationState: true, payout: { select: { id: true } }, shipmentItems: { select: { shipmentId: true, shipment: { select: { status: true } } } }, order: { select: { userId: true, orderNumber: true, payment: { select: { id: true, amount: true, status: true } } } } },
  });
  if (!item) return null;
  if (item.status === "CANCELLED") return { status: "CANCELLED" as const, idempotent: true };
  const shipmentIds = [...new Set(item.shipmentItems.map((link) => link.shipmentId))].sort();
  if (shipmentIds.length) {
    await tx.$queryRaw`SELECT id FROM "Shipment" WHERE id IN (${Prisma.join(shipmentIds)}) ORDER BY id FOR UPDATE`;
    item = await tx.orderItem.findFirst({
      where: { id: input.orderItemId, ...ownership },
      select: { id: true, orderId: true, sellerId: true, productId: true, sellerOfferId: true, productName: true, quantity: true, unitPrice: true, discountAmount: true, commissionAmount: true, status: true, stockReservationState: true, payout: { select: { id: true } }, shipmentItems: { select: { shipmentId: true, shipment: { select: { status: true } } } }, order: { select: { userId: true, orderNumber: true, payment: { select: { id: true, amount: true, status: true } } } } },
    });
    if (!item) return null;
    if (item.status === "CANCELLED") return { status: "CANCELLED" as const, idempotent: true };
  }
  const eligibility = evaluateCancellationEligibility({ itemStatus: item.status, paymentStatus: item.order.payment?.status ?? null, shipmentStatuses: item.shipmentItems.map((link) => link.shipment.status) });
  if (!eligibility.eligible) throw new Error(eligibility.code);
  const changed = await tx.orderItem.updateMany({ where: { id: item.id, status: item.status, ...ownership }, data: { status: "CANCELLED" } });
  if (!changed.count) {
    const latest = await tx.orderItem.findFirst({ where: { id: item.id, ...ownership }, select: { status: true } });
    if (latest?.status === "CANCELLED") return { status: "CANCELLED" as const, idempotent: true };
    throw new Error("CONCURRENT_CHANGE");
  }

  await releaseOrderItemReservation(tx, { orderItemId: item.id, reason: input.actor.kind === "CUSTOMER" ? "CUSTOMER_CANCELLATION" : "SELLER_CANCELLATION", allowConsumed: item.stockReservationState === "CONSUMED", actorUserId: input.actor.userId, actorSellerId: input.actor.kind === "SELLER" ? input.actor.sellerId : undefined });
  const cancellationTime = new Date();
  for (const link of item.shipmentItems) {
    if (!isPreHandoffShipmentStatus(link.shipment.status)) throw new Error("CARRIER_HANDOFF");
    const activeItems = await tx.shipmentItem.count({ where: { shipmentId: link.shipmentId, orderItem: { status: { not: "CANCELLED" } } } });
    if (activeItems === 0) {
      if (link.shipment.status === "CANCELLED") continue;
      const cancelled = await tx.shipment.updateMany({ where: { id: link.shipmentId, status: link.shipment.status }, data: { status: "CANCELLED", cancelledAt: cancellationTime } });
      if (cancelled.count) await tx.shipmentEvent.create({ data: { shipmentId: link.shipmentId, source: "ORCHESTRATOR", externalEventId: `item-cancellation:${item.id}`, status: "CANCELLED", eventTime: cancellationTime, applied: true, description: "Shipment cancelled because no active items remain" } });
    } else {
      await tx.shipmentItem.deleteMany({ where: { shipmentId: link.shipmentId, orderItemId: item.id } });
    }
  }
  await tx.sellerPayout.updateMany({ where: { orderItemId: item.id, status: { in: ["PENDING", "BLOCKED", "AVAILABLE", "SCHEDULED"] } }, data: { status: "CANCELLED", availableAt: null } });

  let refundId: string | null = null;
  const payment = item.order.payment;
  if (eligibility.refundRequired && payment) {
    const amount = item.unitPrice.mul(item.quantity).minus(item.discountAmount).toDecimalPlaces(2);
    const refund = await tx.refund.upsert({ where: { idempotencyKey: `cancellation:${item.id}` }, update: {}, create: { paymentId: payment.id, orderId: item.orderId, orderItemId: item.id, sellerId: item.sellerId, requestedByUserId: input.actor.userId, idempotencyKey: `cancellation:${item.id}`, amount, reason: input.reason?.trim() || `${input.actor.kind === "CUSTOMER" ? "Müşteri" : "Satıcı"} sipariş iptali`, status: "REQUESTED" } });
    refundId = refund.id;
    await tx.financialLedgerEntry.createMany({ data: cancellationLedgerReversals({ sellerId: item.sellerId, orderItemId: item.id, payoutId: item.payout?.id, refundId: refund.id, grossAmount: amount, commissionAmount: item.commissionAmount ?? new Prisma.Decimal(0) }), skipDuplicates: true });
    await synchronizePaymentRefundStatus(tx, payment.id);
  } else if (item.stockReservationState) {
    const amount = item.unitPrice.mul(item.quantity).minus(item.discountAmount).toDecimalPlaces(2);
    await tx.financialLedgerEntry.createMany({ data: cancellationLedgerReversals({ sellerId: item.sellerId, orderItemId: item.id, payoutId: item.payout?.id, grossAmount: amount, commissionAmount: item.commissionAmount ?? new Prisma.Decimal(0), dedupePrefix: "reservation-release" }), skipDuplicates: true });
  }

  await tx.orderStatusHistory.create({ data: { orderItemId: item.id, changedByUserId: input.actor.userId, fromStatus: item.status, toStatus: "CANCELLED" } });
  await tx.financialAuditEvent.create({ data: { paymentId: payment?.id, refundId, orderId: item.orderId, actorUserId: input.actor.userId, entityType: "ORDER_ITEM", entityId: item.id, eventType: `${input.actor.kind}_CANCELLED`, fromStatus: item.status, toStatus: "CANCELLED", source: input.actor.kind, externalEventId: `cancel:${item.id}` } });
  const notification: NotificationDraft = input.actor.kind === "CUSTOMER"
    ? { sellerId: item.sellerId, orderId: item.orderId, type: "ORDER_CANCELLED", dedupeKey: `cancel:${item.id}:seller`, title: "Sipariş kalemi iptal edildi", message: `${item.order.orderNumber} siparişindeki ${item.productName} müşteri tarafından iptal edildi.` }
    : { userId: item.order.userId, orderId: item.orderId, type: "ORDER_CANCELLED", dedupeKey: `cancel:${item.id}:customer`, title: "Sipariş kalemi iptal edildi", message: `${item.order.orderNumber} siparişindeki ${item.productName} satıcı tarafından iptal edildi.` };
  await enqueueNotifications(tx, [notification]);
  await reconcileOrderAggregate(tx, item.orderId);
  return { status: "CANCELLED" as const, idempotent: false, refundId };
}

export async function requestOrderItemReturn(tx: Prisma.TransactionClient, input: { orderItemId: string; userId: string; reason: string }) {
  const item = await tx.orderItem.findFirst({
    where: { id: input.orderItemId, order: { userId: input.userId } },
    select: { id: true, orderId: true, sellerId: true, productName: true, quantity: true, unitPrice: true, discountAmount: true, status: true, order: { select: { orderNumber: true, payment: { select: { id: true, status: true } } } } },
  });
  if (!item) return null;
  if (item.status === "RETURN_REQUESTED") return { status: "RETURN_REQUESTED" as const, idempotent: true };
  if (item.status !== "DELIVERED" && item.status !== "COMPLETED") throw new Error("INVALID_STATE");
  const payment = item.order.payment;
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");
  if (payment.status !== "PAID" && payment.status !== "PARTIAL_REFUND_PENDING" && payment.status !== "REFUND_PENDING") throw new Error("PAYMENT_NOT_PAID");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`return:${item.id}`}, 0))`;

  const refund = await tx.refund.upsert({
    where: { idempotencyKey: `return:${item.id}` },
    update: {},
    create: { paymentId: payment.id, orderId: item.orderId, orderItemId: item.id, sellerId: item.sellerId, requestedByUserId: input.userId, idempotencyKey: `return:${item.id}`, amount: item.unitPrice.mul(item.quantity).minus(item.discountAmount).toDecimalPlaces(2), reason: input.reason },
  });
  const changed = await tx.orderItem.updateMany({ where: { id: item.id, status: { in: ["DELIVERED", "COMPLETED"] }, order: { userId: input.userId } }, data: { status: "RETURN_REQUESTED" } });
  if (!changed.count) {
    const latest = await tx.orderItem.findFirst({ where: { id: item.id, order: { userId: input.userId } }, select: { status: true } });
    if (latest?.status === "RETURN_REQUESTED") return { status: "RETURN_REQUESTED" as const, idempotent: true };
    throw new Error("CONCURRENT_CHANGE");
  }

  await tx.orderStatusHistory.create({ data: { orderItemId: item.id, changedByUserId: input.userId, fromStatus: item.status, toStatus: "RETURN_REQUESTED" } });
  await tx.sellerPayout.updateMany({ where: { orderItemId: item.id, status: { in: ["PENDING", "AVAILABLE", "SCHEDULED"] } }, data: { status: "BLOCKED" } });
  await synchronizePaymentRefundStatus(tx, payment.id);
  await tx.financialAuditEvent.create({ data: { paymentId: payment.id, refundId: refund.id, orderId: item.orderId, actorUserId: input.userId, entityType: "REFUND", entityId: refund.id, eventType: "RETURN_REQUESTED", toStatus: "REQUESTED", source: "CUSTOMER" } });
  await enqueueNotifications(tx, [{ sellerId: item.sellerId, orderId: item.orderId, type: "RETURN_REQUESTED", dedupeKey: `return-request:${refund.id}:seller`, title: "İade talebi", message: `${item.order.orderNumber} siparişindeki ${item.productName} için iade talebi oluşturuldu.` }]);
  await reconcileOrderAggregate(tx, item.orderId);
  return { status: "RETURN_REQUESTED" as const, idempotent: false };
}

export async function decideRefund(tx: Prisma.TransactionClient, input: { refundId: string; actorUserId: string; decision: "APPROVE" | "REJECT" }) {
  const target = input.decision === "APPROVE" ? "APPROVED" as const : "REJECTED" as const;
  const refund = await tx.refund.findUnique({ where: { id: input.refundId }, select: { id: true, status: true, orderId: true, orderItemId: true, paymentId: true, requestedByUserId: true, sellerId: true, order: { select: { orderNumber: true } } } });
  if (!refund) return null;
  if (refund.status === target) return { status: target, idempotent: true };
  if (refund.status !== "REQUESTED") throw new Error("INVALID_STATE");
  const changed = await tx.refund.updateMany({ where: { id: refund.id, status: "REQUESTED" }, data: { status: target } });
  if (!changed.count) {
    const latest = await tx.refund.findUnique({ where: { id: refund.id }, select: { status: true } });
    if (latest?.status === target) return { status: target, idempotent: true };
    throw new Error("CONCURRENT_CHANGE");
  }

  if (target === "REJECTED") {
    const restored = await tx.orderItem.updateMany({ where: { id: refund.orderItemId, status: "RETURN_REQUESTED" }, data: { status: "DELIVERED" } });
    if (restored.count) await tx.orderStatusHistory.create({ data: { orderItemId: refund.orderItemId, changedByUserId: input.actorUserId, fromStatus: "RETURN_REQUESTED", toStatus: "DELIVERED" } });
    await tx.sellerPayout.updateMany({ where: { orderItemId: refund.orderItemId, status: "BLOCKED" }, data: { status: "PENDING", availableAt: null } });
  }
  await synchronizePaymentRefundStatus(tx, refund.paymentId);
  if (target === "REJECTED") await reconcileOrderPayouts(tx, refund.orderId);
  await reconcileOrderAggregate(tx, refund.orderId);
  await tx.financialAuditEvent.create({ data: { paymentId: refund.paymentId, refundId: refund.id, orderId: refund.orderId, actorUserId: input.actorUserId, entityType: "REFUND", entityId: refund.id, eventType: `REFUND_${target}`, fromStatus: refund.status, toStatus: target, source: "ADMIN" } });
  await enqueueNotifications(tx, [{ userId: refund.requestedByUserId ?? undefined, orderId: refund.orderId, type: `REFUND_${target}`, dedupeKey: `refund:${refund.id}:${target}:customer`, title: target === "APPROVED" ? "İade talebi onaylandı" : "İade talebi sonuçlandı", message: `${refund.order.orderNumber} numaralı siparişinizin iade talebi ${target === "APPROVED" ? "onaylandı; finansal iade henüz tamamlanmadı" : "reddedildi"}.` }, { sellerId: refund.sellerId, orderId: refund.orderId, type: `REFUND_${target}`, dedupeKey: `refund:${refund.id}:${target}:seller`, title: "İade talebi güncellendi", message: `${refund.order.orderNumber} siparişindeki iade talebi güncellendi.` }]);
  return { status: target, idempotent: false };
}

export async function transitionOrderItem(tx: Prisma.TransactionClient, input: { orderItemId: string; sellerId: string; actorUserId: string; target: Exclude<OrderStatus, "CANCELLED" | "RETURN_REQUESTED" | "RETURNED">; allowedFrom: OrderStatus[]; shippingCompany?: string; trackingNumber?: string; notification?: NotificationDraft }) {
  const item = await tx.orderItem.findFirst({ where: { id: input.orderItemId, sellerId: input.sellerId }, select: { id: true, orderId: true, status: true } });
  if (!item) return null;
  await assertPaymentPaidForFulfillment(tx, item.orderId);
  if (item.status === input.target) return { status: input.target, idempotent: true };
  if (!input.allowedFrom.includes(item.status)) throw new Error("INVALID_TRANSITION");
  const changed = await tx.orderItem.updateMany({ where: { id: item.id, sellerId: input.sellerId, status: item.status }, data: { status: input.target, ...(input.target === "SHIPPED" ? { shippingCompany: input.shippingCompany, trackingNumber: input.trackingNumber } : {}) } });
  if (!changed.count) throw new Error("CONCURRENT_CHANGE");
  await tx.orderStatusHistory.create({ data: { orderItemId: item.id, changedByUserId: input.actorUserId, fromStatus: item.status, toStatus: input.target } });
  if (input.target === "DELIVERED") await reconcileOrderPayouts(tx, item.orderId);
  if (input.notification) await enqueueNotifications(tx, [input.notification]);
  await reconcileOrderAggregate(tx, item.orderId);
  return { status: input.target, idempotent: false };
}
