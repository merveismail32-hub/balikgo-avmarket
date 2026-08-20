import type { ShipmentStatus } from "@prisma/client";

export const CARRIERS = [
  { code: "YURTICI", displayName: "Yurtiçi Kargo", trackingUrl: (number: string) => `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${encodeURIComponent(number)}` },
  { code: "ARAS", displayName: "Aras Kargo", trackingUrl: (number: string) => `https://kargotakip.araskargo.com.tr/mainpage.aspx?code=${encodeURIComponent(number)}` },
  { code: "MNG", displayName: "MNG Kargo", trackingUrl: (number: string) => `https://www.mngkargo.com.tr/gonderitakip?gonderino=${encodeURIComponent(number)}` },
  { code: "SURAT", displayName: "Sürat Kargo", trackingUrl: (number: string) => `https://www.suratkargo.com.tr/KargoTakip/?kargotakipno=${encodeURIComponent(number)}` },
  { code: "PTT", displayName: "PTT Kargo", trackingUrl: (number: string) => `https://gonderitakip.ptt.gov.tr/Track/Verify?q=${encodeURIComponent(number)}` },
  { code: "UPS_TR", displayName: "UPS Türkiye", trackingUrl: (number: string) => `https://www.ups.com/track?loc=tr_TR&tracknum=${encodeURIComponent(number)}` },
] as const;

export type CarrierCode = (typeof CARRIERS)[number]["code"];
export const normalizeCarrierCode = (code: string) => code.trim().toUpperCase().replaceAll("-", "_");
export const carrierByCode = (code: string) => CARRIERS.find((carrier) => carrier.code === normalizeCarrierCode(code));
export const normalizeTrackingNumber = (number: string) => number.trim();
export const validateTrackingNumber = (number: string) => /^[A-Za-z0-9._/-]{3,80}$/.test(normalizeTrackingNumber(number));
export const trackingUrlFor = (code: string | null, number: string | null) => code && number ? carrierByCode(code)?.trackingUrl(number) ?? null : null;

export const CANONICAL_SHIPMENT_STATUSES = ["CREATED", "READY_FOR_SHIPMENT", "HANDED_TO_CARRIER", "IN_TRANSIT", "AT_TRANSFER_CENTER", "OUT_FOR_DELIVERY", "AT_PICKUP_POINT", "DELIVERED", "DELIVERY_FAILED", "RETURNING", "RETURNED", "CANCELLED"] as const;
export type CanonicalShipmentStatus = (typeof CANONICAL_SHIPMENT_STATUSES)[number];
const CARRIER_STATUS_ALIASES: Record<string, CanonicalShipmentStatus> = {
  CREATED: "CREATED", NOT_READY: "CREATED", PREPARING: "CREATED",
  READY: "READY_FOR_SHIPMENT", READY_FOR_SHIPMENT: "READY_FOR_SHIPMENT", READY_TO_SHIP: "READY_FOR_SHIPMENT",
  HANDED_TO_CARRIER: "HANDED_TO_CARRIER", SHIPPED: "HANDED_TO_CARRIER",
  IN_TRANSIT: "IN_TRANSIT", AT_TRANSFER_CENTER: "AT_TRANSFER_CENTER", OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  AT_PICKUP_POINT: "AT_PICKUP_POINT", DELIVERED: "DELIVERED", DELIVERY_FAILED: "DELIVERY_FAILED",
  RETURNING: "RETURNING", RETURNED: "RETURNED", CANCELLED: "CANCELLED", CANCELED: "CANCELLED",
};
export const normalizeCarrierStatus = (value: string) => CARRIER_STATUS_ALIASES[value.trim().toUpperCase().replaceAll(/[ -]/g, "_")] ?? null;

export type CarrierAdapter = {
  normalizeStatus(value: string): CanonicalShipmentStatus | null;
  normalizeEvent<T extends { status: string; trackingNumber: string }>(event: T): T & { status: CanonicalShipmentStatus; trackingNumber: string } | null;
  buildTrackingUrl(trackingNumber: string): string | null;
  validateTrackingNumber(trackingNumber: string): boolean;
};
export const carrierAdapterFor = (code: string): CarrierAdapter | null => {
  const carrier = carrierByCode(code); if (!carrier) return null;
  return {
    normalizeStatus: normalizeCarrierStatus,
    normalizeEvent: (event) => { const status = normalizeCarrierStatus(event.status); const trackingNumber = normalizeTrackingNumber(event.trackingNumber); return status && validateTrackingNumber(trackingNumber) ? { ...event, status, trackingNumber } : null; },
    buildTrackingUrl: (trackingNumber) => validateTrackingNumber(trackingNumber) ? carrier.trackingUrl(normalizeTrackingNumber(trackingNumber)) : null,
    validateTrackingNumber,
  };
};

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  CREATED: "Oluşturuldu",
  NOT_READY: "Hazırlanmayı Bekliyor", PREPARING: "Hazırlanıyor", READY_TO_SHIP: "Kargoya Hazır",
  READY_FOR_SHIPMENT: "Gönderime Hazır", HANDED_TO_CARRIER: "Taşıyıcıya Teslim Edildi", SHIPPED: "Kargoya Verildi",
  IN_TRANSIT: "Yolda", AT_TRANSFER_CENTER: "Transfer Merkezinde", OUT_FOR_DELIVERY: "Dağıtımda", AT_PICKUP_POINT: "Teslimat Noktasında",
  DELIVERED: "Teslim Edildi", DELIVERY_FAILED: "Teslim Edilemedi", RETURNING: "İade Yolunda", RETURNED: "İade Edildi", CANCELLED: "İptal Edildi",
};

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  CREATED: ["READY_FOR_SHIPMENT", "CANCELLED"],
  NOT_READY: ["PREPARING", "CANCELLED"], PREPARING: ["READY_TO_SHIP", "CANCELLED"],
  READY_TO_SHIP: ["SHIPPED", "HANDED_TO_CARRIER", "CANCELLED"], SHIPPED: ["IN_TRANSIT", "AT_TRANSFER_CENTER", "OUT_FOR_DELIVERY", "AT_PICKUP_POINT", "DELIVERED", "DELIVERY_FAILED", "RETURNING"], DELIVERED: [], CANCELLED: [],
  READY_FOR_SHIPMENT: ["HANDED_TO_CARRIER", "CANCELLED"], HANDED_TO_CARRIER: ["IN_TRANSIT", "AT_TRANSFER_CENTER", "OUT_FOR_DELIVERY", "AT_PICKUP_POINT", "DELIVERED", "DELIVERY_FAILED", "RETURNING"],
  IN_TRANSIT: ["AT_TRANSFER_CENTER", "OUT_FOR_DELIVERY", "AT_PICKUP_POINT", "DELIVERED", "DELIVERY_FAILED", "RETURNING"],
  AT_TRANSFER_CENTER: ["IN_TRANSIT", "OUT_FOR_DELIVERY", "AT_PICKUP_POINT", "DELIVERED", "DELIVERY_FAILED", "RETURNING"],
  OUT_FOR_DELIVERY: ["AT_PICKUP_POINT", "DELIVERED", "DELIVERY_FAILED", "RETURNING"], AT_PICKUP_POINT: ["OUT_FOR_DELIVERY", "DELIVERED", "RETURNING"],
  DELIVERY_FAILED: ["IN_TRANSIT", "AT_TRANSFER_CENTER", "OUT_FOR_DELIVERY", "AT_PICKUP_POINT", "RETURNING"], RETURNING: ["RETURNED"], RETURNED: [],
};

type ShipmentOrderStatus = "NEW" | "PREPARING" | "READY_TO_SHIP" | "SHIPPED" | "DELIVERED" | "CANCELLED";
const SHIPMENT_ORDER_STATUS: Record<ShipmentStatus, ShipmentOrderStatus> = {
  CREATED: "NEW",
  NOT_READY: "NEW", PREPARING: "PREPARING", READY_TO_SHIP: "READY_TO_SHIP", SHIPPED: "SHIPPED",
  READY_FOR_SHIPMENT: "READY_TO_SHIP", HANDED_TO_CARRIER: "SHIPPED", IN_TRANSIT: "SHIPPED", AT_TRANSFER_CENTER: "SHIPPED",
  OUT_FOR_DELIVERY: "SHIPPED", AT_PICKUP_POINT: "SHIPPED", DELIVERED: "DELIVERED", DELIVERY_FAILED: "SHIPPED",
  RETURNING: "SHIPPED", RETURNED: "SHIPPED", CANCELLED: "CANCELLED",
};
export const shipmentToOrderStatus = (status: ShipmentStatus): ShipmentOrderStatus => SHIPMENT_ORDER_STATUS[status];

export const canonicalShipmentStatus = (status: ShipmentStatus): CanonicalShipmentStatus => ({ NOT_READY: "CREATED", PREPARING: "CREATED", READY_TO_SHIP: "READY_FOR_SHIPMENT", SHIPPED: "HANDED_TO_CARRIER" } as Partial<Record<ShipmentStatus, CanonicalShipmentStatus>>)[status] ?? status as CanonicalShipmentStatus;

export function carrierEventDecision(current: ShipmentStatus, target: ShipmentStatus, eventTime: Date, latestAppliedEventTime?: Date) {
  if (latestAppliedEventTime && eventTime < latestAppliedEventTime) return { apply: false, stale: true, equivalent: false } as const;
  if (canonicalShipmentStatus(target) === canonicalShipmentStatus(current)) return { apply: false, stale: false, equivalent: true } as const;
  const apply = SHIPMENT_TRANSITIONS[current].includes(target);
  return { apply, stale: !apply, equivalent: false } as const;
}
