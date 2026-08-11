import type { OrderStatus, ShipmentStatus } from "@prisma/client";

export const CARRIERS = [
  { code: "YURTICI", displayName: "Yurtiçi Kargo", trackingUrl: (number: string) => `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${encodeURIComponent(number)}` },
  { code: "ARAS", displayName: "Aras Kargo", trackingUrl: (number: string) => `https://kargotakip.araskargo.com.tr/mainpage.aspx?code=${encodeURIComponent(number)}` },
  { code: "MNG", displayName: "MNG Kargo", trackingUrl: (number: string) => `https://www.mngkargo.com.tr/gonderitakip?gonderino=${encodeURIComponent(number)}` },
  { code: "SURAT", displayName: "Sürat Kargo", trackingUrl: (number: string) => `https://www.suratkargo.com.tr/KargoTakip/?kargotakipno=${encodeURIComponent(number)}` },
  { code: "PTT", displayName: "PTT Kargo", trackingUrl: (number: string) => `https://gonderitakip.ptt.gov.tr/Track/Verify?q=${encodeURIComponent(number)}` },
  { code: "UPS_TR", displayName: "UPS Türkiye", trackingUrl: (number: string) => `https://www.ups.com/track?loc=tr_TR&tracknum=${encodeURIComponent(number)}` },
] as const;

export type CarrierCode = (typeof CARRIERS)[number]["code"];
export const carrierByCode = (code: string) => CARRIERS.find((carrier) => carrier.code === code);
export const trackingUrlFor = (code: string | null, number: string | null) => code && number ? carrierByCode(code)?.trackingUrl(number) ?? null : null;

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  NOT_READY: "Hazırlanmayı Bekliyor", PREPARING: "Hazırlanıyor", READY_TO_SHIP: "Kargoya Hazır",
  SHIPPED: "Kargoya Verildi", DELIVERED: "Teslim Edildi", CANCELLED: "İptal Edildi",
};

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  NOT_READY: ["PREPARING", "CANCELLED"], PREPARING: ["READY_TO_SHIP", "CANCELLED"],
  READY_TO_SHIP: ["SHIPPED", "CANCELLED"], SHIPPED: ["DELIVERED"], DELIVERED: [], CANCELLED: [],
};

const SHIPMENT_ORDER_STATUS: Record<ShipmentStatus, OrderStatus> = {
  NOT_READY: "NEW", PREPARING: "PREPARING", READY_TO_SHIP: "READY_TO_SHIP", SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED", CANCELLED: "CANCELLED",
};
export const shipmentToOrderStatus = (status: ShipmentStatus): OrderStatus => SHIPMENT_ORDER_STATUS[status];
