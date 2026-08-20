import type { OrderStatus, PaymentStatus, ShipmentStatus } from "@prisma/client";

const CANCELLABLE_ITEM_STATUSES = new Set<OrderStatus>(["NEW", "PREPARING"]);
const PRE_HANDOFF_SHIPMENT_STATUSES = new Set<ShipmentStatus>([
  "CREATED", "NOT_READY", "PREPARING", "READY_TO_SHIP", "READY_FOR_SHIPMENT", "CANCELLED",
]);
const REFUNDABLE_PAYMENT_STATUSES = new Set<PaymentStatus>(["PAID", "PARTIAL_REFUND_PENDING", "REFUND_PENDING"]);

export type CancellationEligibility =
  | { eligible: true; refundRequired: boolean }
  | { eligible: false; code: "ALREADY_CANCELLED" | "INVALID_ITEM_STATE" | "CARRIER_HANDOFF" | "RETURN_REQUIRED" };

export function evaluateCancellationEligibility(input: {
  itemStatus: OrderStatus;
  paymentStatus: PaymentStatus | null;
  shipmentStatuses: ShipmentStatus[];
}): CancellationEligibility {
  if (input.itemStatus === "CANCELLED") return { eligible: false, code: "ALREADY_CANCELLED" };
  if (input.itemStatus === "DELIVERED" || input.itemStatus === "COMPLETED" || input.itemStatus === "RETURN_REQUESTED" || input.itemStatus === "RETURNED") {
    return { eligible: false, code: "RETURN_REQUIRED" };
  }
  if (!CANCELLABLE_ITEM_STATUSES.has(input.itemStatus)) return { eligible: false, code: "INVALID_ITEM_STATE" };
  if (input.shipmentStatuses.some((status) => !PRE_HANDOFF_SHIPMENT_STATUSES.has(status))) return { eligible: false, code: "CARRIER_HANDOFF" };
  return { eligible: true, refundRequired: input.paymentStatus !== null && REFUNDABLE_PAYMENT_STATUSES.has(input.paymentStatus) };
}

export function isPreHandoffShipmentStatus(status: ShipmentStatus) {
  return PRE_HANDOFF_SHIPMENT_STATUSES.has(status);
}
