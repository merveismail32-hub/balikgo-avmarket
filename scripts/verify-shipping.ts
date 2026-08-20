import assert from "node:assert/strict";
import { CARRIERS, SHIPMENT_TRANSITIONS, carrierAdapterFor, carrierByCode, carrierEventDecision, canonicalShipmentStatus, normalizeCarrierStatus, shipmentToOrderStatus, trackingUrlFor } from "../app/lib/shipping";

assert.equal(new Set(CARRIERS.map((carrier) => carrier.code)).size, CARRIERS.length, "Carrier kodları benzersiz olmalı.");
assert.equal(carrierByCode("javascript:alert(1)"), undefined, "Bilinmeyen carrier reddedilmeli.");
assert.equal(trackingUrlFor("UNKNOWN", "javascript:alert(1)"), null, "Bilinmeyen carrier URL üretmemeli.");
for (const carrier of CARRIERS) {
  const url = trackingUrlFor(carrier.code, "ABC/123");
  assert.ok(url?.startsWith("https://"), `${carrier.code} yalnızca HTTPS URL üretmeli.`);
  assert.ok(!url?.includes("javascript:"), "Tracking URL script şeması içeremez.");
}
assert.deepEqual(SHIPMENT_TRANSITIONS.NOT_READY, ["PREPARING", "CANCELLED"]);
assert.deepEqual(SHIPMENT_TRANSITIONS.DELIVERED, []);
assert.equal(shipmentToOrderStatus("SHIPPED"), "SHIPPED");
assert.equal(shipmentToOrderStatus("DELIVERED"), "DELIVERED");
assert.equal(normalizeCarrierStatus("out for delivery"), "OUT_FOR_DELIVERY");
assert.equal(normalizeCarrierStatus("unknown-provider-state"), null);
assert.equal(canonicalShipmentStatus("SHIPPED"), "HANDED_TO_CARRIER");
assert.equal(carrierAdapterFor("yurtici")?.normalizeEvent({ status: "in transit", trackingNumber: " ABC-123 " })?.trackingNumber, "ABC-123");
assert.equal(carrierAdapterFor("yurtici")?.normalizeEvent({ status: "in transit", trackingNumber: "<script>" }), null);
const now = new Date("2026-08-20T12:00:00Z");
assert.deepEqual(carrierEventDecision("IN_TRANSIT", "OUT_FOR_DELIVERY", now), { apply: true, stale: false, equivalent: false });
assert.deepEqual(carrierEventDecision("OUT_FOR_DELIVERY", "IN_TRANSIT", new Date("2026-08-20T11:00:00Z"), now), { apply: false, stale: true, equivalent: false });
assert.deepEqual(carrierEventDecision("SHIPPED", "HANDED_TO_CARRIER", now), { apply: false, stale: false, equivalent: true });
assert.deepEqual(carrierEventDecision("DELIVERED", "IN_TRANSIT", new Date("2026-08-20T13:00:00Z"), now), { apply: false, stale: true, equivalent: false });
console.log("PASS: carrier boundary, canonical normalization, trusted tracking URLs, transitions and out-of-order protection verified.");
