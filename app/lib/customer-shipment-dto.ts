import type { CustomerOrderRecord } from "./customer-order-select";
import { canonicalShipmentStatus, shipmentStatusLabel, trackingUrlFor } from "./shipping";
import { featureDecision } from "./feature-flags";

export function toCustomerOrderDto(order: CustomerOrderRecord) {
  const context = { orderId: order.id };
  const timelineEnabled = featureDecision("CUSTOMER_SHIPMENT_TIMELINE", context).enabled;
  const trackingLinkEnabled = featureDecision("CUSTOMER_TRACKING_LINK", context).enabled;
  return {
    ...order,
    shipments: order.shipments.map(({ events, ...shipment }) => ({
      ...shipment,
      normalizedStatus: canonicalShipmentStatus(shipment.status),
      carrier: shipment.carrierCode && shipment.carrierName ? { code: shipment.carrierCode, name: shipment.carrierName } : null,
      trackingUrl: trackingLinkEnabled ? trackingUrlFor(shipment.carrierCode, shipment.trackingNumber) : null,
      timeline: timelineEnabled ? events.filter((event) => event.applied).map((event) => ({ id: event.id, status: canonicalShipmentStatus(event.status), label: shipmentStatusLabel(event.status), eventTime: event.eventTime, receivedAt: event.receivedAt, location: event.location, description: event.description })) : [],
    })),
  };
}
