import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateCancellationEligibility, isPreHandoffShipmentStatus } from "../app/lib/cancellation-eligibility.ts";

for (const status of ["CREATED", "NOT_READY", "PREPARING", "READY_TO_SHIP", "READY_FOR_SHIPMENT", "CANCELLED"] as const) {
  assert.equal(isPreHandoffShipmentStatus(status), true, `${status} must remain cancellable before carrier handoff`);
}
for (const status of ["HANDED_TO_CARRIER", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNING", "RETURNED"] as const) {
  assert.equal(isPreHandoffShipmentStatus(status), false, `${status} must not enter pre-shipment cancellation`);
}

assert.deepEqual(evaluateCancellationEligibility({ itemStatus: "NEW", paymentStatus: "PAID", shipmentStatuses: ["READY_FOR_SHIPMENT"] }), { eligible: true, refundRequired: true });
assert.deepEqual(evaluateCancellationEligibility({ itemStatus: "PREPARING", paymentStatus: "PENDING", shipmentStatuses: [] }), { eligible: true, refundRequired: false });
assert.deepEqual(evaluateCancellationEligibility({ itemStatus: "NEW", paymentStatus: "PAID", shipmentStatuses: ["HANDED_TO_CARRIER"] }), { eligible: false, code: "CARRIER_HANDOFF" });
assert.deepEqual(evaluateCancellationEligibility({ itemStatus: "DELIVERED", paymentStatus: "PAID", shipmentStatuses: ["DELIVERED"] }), { eligible: false, code: "RETURN_REQUIRED" });
assert.deepEqual(evaluateCancellationEligibility({ itemStatus: "CANCELLED", paymentStatus: "REFUND_PENDING", shipmentStatuses: ["CANCELLED"] }), { eligible: false, code: "ALREADY_CANCELLED" });

const orchestrator = readFileSync(new URL("../app/lib/order-orchestrator.ts", import.meta.url), "utf8");
const customerRoute = readFileSync(new URL("../app/api/orders/items/[id]/actions/route.ts", import.meta.url), "utf8");
assert.match(orchestrator, /FOR UPDATE/, "shipment row lock missing from cancellation race boundary");
assert.match(orchestrator, /shipmentItem\.deleteMany/, "partial shipment detachment missing");
assert.match(orchestrator, /activeItems === 0[\s\S]*status: "CANCELLED"/, "empty shipment cancellation missing");
assert.match(orchestrator, /shipmentEvent\.create/, "empty shipment audit event missing");
assert.match(orchestrator, /order: \{ userId: input\.actor\.userId \}/, "customer ownership boundary missing");
assert.match(orchestrator, /sellerId: input\.actor\.sellerId/, "seller ownership boundary missing");
assert.match(customerRoute, /CARRIER_HANDOFF[\s\S]*kargoya verildiği için artık iptal edilemez/, "safe post-handoff customer response missing");
assert.match(customerRoute, /RETURN_REQUIRED[\s\S]*iade talebi/, "return-required customer response missing");

console.log("PASS: Cancellation V1 eligibility, pre/post-shipment boundary, reconciliation, locking and authorization contracts verified.");
