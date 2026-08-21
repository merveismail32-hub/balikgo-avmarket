import { Prisma, type OrderStatus, type PaymentStatus } from "@prisma/client";

export function aggregateOrderStatus(statuses: OrderStatus[]): OrderStatus {
  const active = statuses.filter((status) => status !== "CANCELLED");
  if (!active.length) return "CANCELLED";
  if (active.some((status) => status === "RETURN_REQUESTED")) return "RETURN_REQUESTED";
  if (active.every((status) => status === "RETURNED")) return "RETURNED";
  if (active.every((status) => status === "DELIVERED" || status === "COMPLETED")) return "DELIVERED";
  if (active.some((status) => status === "SHIPPED" || status === "DELIVERED" || status === "COMPLETED")) return "SHIPPED";
  if (active.some((status) => status === "READY_TO_SHIP")) return "READY_TO_SHIP";
  if (active.some((status) => status === "PREPARING")) return "PREPARING";
  return "NEW";
}

export function pendingRefundPaymentStatus(refundTotal: Prisma.Decimal, paymentAmount: Prisma.Decimal): PaymentStatus {
  return refundTotal.greaterThanOrEqualTo(paymentAmount) ? "REFUND_PENDING" : "PARTIAL_REFUND_PENDING";
}

export function isPayoutEligible(input: { paymentStatus: PaymentStatus; itemStatus: OrderStatus; hasOpenRefund: boolean }) {
  return isPaymentEligibleForFulfillment(input.paymentStatus) && (input.itemStatus === "DELIVERED" || input.itemStatus === "COMPLETED") && !input.hasOpenRefund;
}

export function isPaymentEligibleForFulfillment(status: PaymentStatus) { return status === "PAID" || status === "PARTIAL_REFUND_PENDING"; }

export function cancellationLedgerReversals(input: { sellerId: string; orderItemId: string; payoutId?: string | null; refundId?: string | null; grossAmount: Prisma.Decimal; commissionAmount: Prisma.Decimal; dedupePrefix?: string }) {
  const prefix = input.dedupePrefix ?? "cancel";
  return [
    { sellerId: input.sellerId, orderItemId: input.orderItemId, payoutId: input.payoutId ?? null, refundId: input.refundId ?? null, dedupeKey: `${prefix}:${input.orderItemId}:sale-reversal`, type: "SALE_REVERSAL" as const, amount: input.grossAmount.negated() },
    { sellerId: input.sellerId, orderItemId: input.orderItemId, payoutId: input.payoutId ?? null, refundId: input.refundId ?? null, dedupeKey: `${prefix}:${input.orderItemId}:commission-reversal`, type: "COMMISSION_REVERSAL" as const, amount: input.commissionAmount.negated() },
  ];
}
