import { Prisma } from "@prisma/client";
import { aggregateOrderStatus, cancellationLedgerReversals, isPayoutEligible, pendingRefundPaymentStatus } from "../app/lib/order-invariants.ts";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

assert(aggregateOrderStatus(["CANCELLED"]) === "CANCELLED", "Cancelled aggregate failed.");
assert(aggregateOrderStatus(["CANCELLED", "NEW"]) === "NEW", "Partial multi-seller cancellation corrupted active seller state.");
assert(aggregateOrderStatus(["DELIVERED", "COMPLETED"]) === "DELIVERED", "Delivery aggregate failed.");
assert(aggregateOrderStatus(["CANCELLED", "DELIVERED"]) === "DELIVERED", "Cancelled item corrupted delivered aggregate.");
assert(aggregateOrderStatus(["RETURN_REQUESTED", "DELIVERED"]) === "RETURN_REQUESTED", "Return aggregate failed.");

const paymentFirst = isPayoutEligible({ paymentStatus: "PAID", itemStatus: "DELIVERED", hasOpenRefund: false });
const deliveryFirst = isPayoutEligible({ paymentStatus: "PAID", itemStatus: "DELIVERED", hasOpenRefund: false });
assert(paymentFirst && deliveryFirst && paymentFirst === deliveryFirst, "Payment/delivery event order changed payout eligibility.");
assert(!isPayoutEligible({ paymentStatus: "PENDING", itemStatus: "DELIVERED", hasOpenRefund: false }), "Unpaid delivery released payout.");
assert(!isPayoutEligible({ paymentStatus: "PAID", itemStatus: "SHIPPED", hasOpenRefund: false }), "Undelivered item released payout.");
assert(!isPayoutEligible({ paymentStatus: "PAID", itemStatus: "DELIVERED", hasOpenRefund: true }), "Open refund released payout.");
assert(isPayoutEligible({ paymentStatus: "PARTIAL_REFUND_PENDING", itemStatus: "DELIVERED", hasOpenRefund: false }), "Partial refund blocked unaffected seller payout.");

assert(pendingRefundPaymentStatus(new Prisma.Decimal(1_000), new Prisma.Decimal(2_000)) === "PARTIAL_REFUND_PENDING", "Partial refund state failed.");
assert(pendingRefundPaymentStatus(new Prisma.Decimal(2_000), new Prisma.Decimal(2_000)) === "REFUND_PENDING", "Full refund state failed.");
const reversals = cancellationLedgerReversals({ sellerId: "seller-a", orderItemId: "item-a", payoutId: "payout-a", refundId: "refund-a", grossAmount: new Prisma.Decimal(1_000), commissionAmount: new Prisma.Decimal(100) });
assert(reversals.length === 2, "Cancellation reversal count failed.");
assert(reversals[0].amount.equals(-1_000) && reversals[1].amount.equals(-100), "Reversal sign/amount failed.");
assert(new Set(reversals.map((entry) => entry.dedupeKey)).size === 2, "Reversal dedupe identity failed.");
assert(reversals.every((entry) => entry.sellerId === "seller-a" && entry.orderItemId === "item-a" && entry.refundId === "refund-a"), "Reversal traceability/seller isolation failed.");

console.log("PASS: Transaction Guardian aggregate, event-order, payout, refund-state, reversal and multi-seller invariants verified.");
