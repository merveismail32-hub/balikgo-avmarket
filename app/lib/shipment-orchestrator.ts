import "server-only";

import type { Prisma, ShipmentStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { SHIPMENT_STATUS_LABELS, SHIPMENT_TRANSITIONS, carrierByCode, shipmentToOrderStatus } from "./shipping";
import { enqueueNotifications } from "./notifications";
import { assertPaymentPaidForFulfillment, cancelOrderItem, transitionOrderItem } from "./order-orchestrator";

export type ShipmentTransitionInput = {
  shipmentId: string;
  sellerId: string;
  sellerUserId: string;
  status: ShipmentStatus;
  carrierCode?: string;
  trackingNumber?: string;
};

type TransitionContext = ShipmentTransitionInput & { source: string; externalEventId: string; eventTime: Date; createEvent?: boolean };

export async function transitionShipmentInTransaction(tx: Prisma.TransactionClient, input: TransitionContext) {
    const shipment = await tx.shipment.findFirst({ where: { id: input.shipmentId, sellerId: input.sellerId }, select: { status: true, orderId: true, order: { select: { userId: true, orderNumber: true } }, items: { select: { orderItemId: true, orderItem: { select: { status: true } } } } } });
    if (!shipment) return null;
    const target = input.status;
    if (target !== "CANCELLED") await assertPaymentPaidForFulfillment(tx, shipment.orderId);
    if (target === shipment.status) return { status: target, idempotent: true };
    if (!SHIPMENT_TRANSITIONS[shipment.status].includes(target)) throw new Error("INVALID_TRANSITION");
    const carrier = input.carrierCode ? carrierByCode(input.carrierCode) : undefined;
    const now = new Date();
    const changed = await tx.shipment.updateMany({ where: { id: input.shipmentId, sellerId: input.sellerId, status: shipment.status }, data: { status: target, ...(target === "PREPARING" ? { preparedAt: now } : {}), ...(target === "SHIPPED" ? { carrierCode: carrier!.code, carrierName: carrier!.displayName, trackingNumber: input.trackingNumber, shippedAt: now } : {}), ...(target === "DELIVERED" ? { deliveredAt: now } : {}), ...(target === "CANCELLED" ? { cancelledAt: now } : {}) } });
    if (!changed.count) throw new Error("CONCURRENT_CHANGE");
    if (input.createEvent !== false) await tx.shipmentEvent.create({ data: { shipmentId: input.shipmentId, source: input.source, externalEventId: input.externalEventId, status: target, eventTime: input.eventTime, applied: true } });
    const orderStatus = shipmentToOrderStatus(target);
    for (const item of shipment.items) {
      if (item.orderItem.status === orderStatus) continue;
      if (orderStatus === "CANCELLED") await cancelOrderItem(tx, { orderItemId: item.orderItemId, actor: { kind: "SELLER", userId: input.sellerUserId, sellerId: input.sellerId }, reason: "Gönderi hazırlığı sırasında satıcı iptali" });
      else await transitionOrderItem(tx, { orderItemId: item.orderItemId, sellerId: input.sellerId, actorUserId: input.sellerUserId, target: orderStatus, allowedFrom: [item.orderItem.status], shippingCompany: target === "SHIPPED" ? carrier!.displayName : undefined, trackingNumber: input.trackingNumber });
    }
    if (target !== "CANCELLED") await enqueueNotifications(tx, [{ userId: shipment.order.userId, orderId: shipment.orderId, type: `SHIPMENT_${target}`, dedupeKey: `shipment:${input.shipmentId}:${target}:customer`, title: "Gönderi durumu güncellendi", message: `${shipment.order.orderNumber} siparişinizdeki paket: ${SHIPMENT_STATUS_LABELS[target]}.` }]);
    return { status: target, idempotent: false };
}

export async function transitionSellerShipment(input: ShipmentTransitionInput) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    return transitionShipmentInTransaction(tx, { ...input, source: "SELLER", externalEventId: `seller:${input.status}`, eventTime: now });
  });
}
