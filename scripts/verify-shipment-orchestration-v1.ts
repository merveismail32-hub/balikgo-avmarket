import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toCustomerOrderDto } from "../app/lib/customer-shipment-dto";
import type { CustomerOrderRecord } from "../app/lib/customer-order-select";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const ingestion = readFileSync(new URL("../app/lib/shipment-event-ingestion.ts", import.meta.url), "utf8");
const creation = readFileSync(new URL("../app/api/seller/shipments/route.ts", import.meta.url), "utf8");
assert.match(schema, /model ShipmentEvent[\s\S]*@@unique\(\[shipmentId, source, externalEventId\]\)/, "carrier event idempotency constraint missing");
assert.match(schema, /events\s+ShipmentEvent\[\]/, "Shipment event relation missing");
assert.match(ingestion, /carrierEventDecision/, "out-of-order decision boundary missing");
assert.match(ingestion, /carrierCode: source, trackingNumber: normalized\.trackingNumber/, "carrier/tracking ownership boundary missing");
assert.match(creation, /shipmentItems: \{ none: \{\} \}/, "split shipment overlap guard missing");
assert.match(creation, /sellerId: seller\.id/, "split shipment seller ownership guard missing");

const eventTime = new Date("2026-08-20T12:00:00Z");
const order = {
  id: "order-1", orderNumber: "BG-1", status: "SHIPPED", totalAmount: 10, subtotalAmount: 10, discountAmount: 0,
  couponCode: null, recipientName: "Customer", phone: "000", city: "Istanbul", district: "Test", address: "Test", postalCode: null,
  createdAt: eventTime, updatedAt: eventTime, payment: { status: "PAID" }, items: [],
  shipments: [{ id: "shipment-1", status: "SHIPPED", carrierCode: "YURTICI", carrierName: "Yurtiçi Kargo", trackingNumber: "ABC-123", preparedAt: null, shippedAt: eventTime, deliveredAt: null, estimatedDeliveryAt: null, seller: { id: "seller-1", storeName: "Store", storeSlug: "store" }, items: [], events: [{ id: "event-1", status: "IN_TRANSIT", eventTime, receivedAt: eventTime, location: "Hub", description: "Yolda", applied: true, source: "YURTICI", externalEventId: "secret-provider-id", payloadHash: "secret-hash" }] }],
} as unknown as CustomerOrderRecord;
const dto = toCustomerOrderDto(order);
assert.equal(dto.shipments[0].normalizedStatus, "HANDED_TO_CARRIER");
assert.ok(dto.shipments[0].trackingUrl?.startsWith("https://"));
assert.deepEqual(dto.shipments[0].carrier, { code: "YURTICI", name: "Yurtiçi Kargo" });
assert.equal(dto.shipments[0].timeline[0].status, "IN_TRANSIT");
const serialized = JSON.stringify(dto);
for (const internal of ["payloadHash", "externalEventId", "secret-provider-id", "secret-hash", "source"]) assert.ok(!serialized.includes(internal), `customer DTO leaks ${internal}`);

console.log("PASS: ShipmentEvent uniqueness, ingestion ownership boundary and customer-safe tracking DTO verified.");
