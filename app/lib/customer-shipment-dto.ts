import type { CustomerOrderRecord } from "./customer-order-select";
import { canonicalShipmentStatus, SHIPMENT_STATUS_LABELS, trackingUrlFor } from "./shipping";

export function toCustomerOrderDto(order: CustomerOrderRecord) {
  return {
    ...order,
    shipments: order.shipments.map(({ events, ...shipment }) => ({
      ...shipment,
      normalizedStatus: canonicalShipmentStatus(shipment.status),
      carrier: shipment.carrierCode && shipment.carrierName ? { code: shipment.carrierCode, name: shipment.carrierName } : null,
      trackingUrl: trackingUrlFor(shipment.carrierCode, shipment.trackingNumber),
      timeline: events.map((event) => ({ id: event.id, status: canonicalShipmentStatus(event.status), label: SHIPMENT_STATUS_LABELS[event.status], eventTime: event.eventTime, receivedAt: event.receivedAt, location: event.location, description: event.description, applied: event.applied })),
    })),
  };
}
