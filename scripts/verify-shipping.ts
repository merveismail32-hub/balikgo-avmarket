import assert from "node:assert/strict";
import { CARRIERS, SHIPMENT_TRANSITIONS, carrierByCode, shipmentToOrderStatus, trackingUrlFor } from "../app/lib/shipping";

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
console.log("PASS: carrier registry, trusted tracking URLs and shipment transition rules verified.");
