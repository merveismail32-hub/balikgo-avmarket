import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateOrderStatus, isPaymentEligibleForFulfillment, isPayoutEligible } from "../app/lib/order-invariants";

const matrix = [
  [["NEW", "NEW"], "NEW"], [["PREPARING", "NEW"], "PREPARING"], [["SHIPPED", "PREPARING"], "SHIPPED"],
  [["DELIVERED", "CANCELLED"], "DELIVERED"], [["CANCELLED", "CANCELLED"], "CANCELLED"],
  [["DELIVERED", "RETURN_REQUESTED"], "RETURN_REQUESTED"], [["RETURNED", "CANCELLED"], "RETURNED"],
] as const;
for (const [items, expected] of matrix) assert.equal(aggregateOrderStatus([...items]), expected, `${items.join("+")} aggregate failed`);
assert.equal(isPaymentEligibleForFulfillment("PAID"), true); assert.equal(isPaymentEligibleForFulfillment("PARTIAL_REFUND_PENDING"), true); assert.equal(isPaymentEligibleForFulfillment("REFUND_PENDING"), false); assert.equal(isPaymentEligibleForFulfillment("PENDING"), false);
assert.equal(isPayoutEligible({ paymentStatus: "PARTIAL_REFUND_PENDING", itemStatus: "DELIVERED", hasOpenRefund: false }), true, "unaffected seller payout blocked by partial refund");
assert.equal(isPayoutEligible({ paymentStatus: "PARTIAL_REFUND_PENDING", itemStatus: "DELIVERED", hasOpenRefund: true }), false, "refunded item payout became eligible");
const reconciliation = readFileSync(new URL("../app/lib/order-reconciliation.ts", import.meta.url), "utf8");
const orchestrator = readFileSync(new URL("../app/lib/order-orchestrator.ts", import.meta.url), "utf8");
const reservation = readFileSync(new URL("../app/lib/stock-reservation.ts", import.meta.url), "utf8");
assert.match(reconciliation, /FROM "Order"[\s\S]*FOR UPDATE/, "aggregate reconciliation does not serialize on Order");
assert.match(reconciliation, /aggregateOrderStatus/, "canonical aggregate policy is not reused");
assert.match(reconciliation, /locked\[0\]\.status === status[\s\S]*changed: false/, "idempotent no-op boundary missing");
assert.doesNotMatch(orchestrator, /refreshAggregateOrderStatus/, "legacy unlocked aggregate writer remains");
assert.equal(orchestrator.match(/reconcileOrderAggregate\(tx,/g)?.length, 4, "not all orchestrated item/refund transitions reconcile centrally");
assert.match(reservation, /reconcileOrderAggregate\(tx, payment\.orderId\)/, "payment failure/expiry bypasses aggregate authority");
console.log("PASS: serialized aggregate authority, mixed-state matrix, idempotent reconciliation and payment compensation integration verified.");
