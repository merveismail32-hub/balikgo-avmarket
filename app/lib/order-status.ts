import type { OrderStatus } from "@prisma/client";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: "Yeni",
  PREPARING: "Hazırlanıyor",
  READY_TO_SHIP: "Kargoya Hazır",
  SHIPPED: "Kargolandı",
  COMPLETED: "Teslim Edildi",
  DELIVERED: "Teslim Edildi",
  CANCELLED: "İptal Edildi",
  RETURN_REQUESTED: "İade Talebi",
  RETURNED: "İade Edildi",
};

export const SELLER_ORDER_TRANSITIONS: Partial<Record<OrderStatus, { label: string; target: OrderStatus }>> = {
  NEW: { label: "Hazırlamaya Başla", target: "PREPARING" },
  PREPARING: { label: "Kargoya Hazır", target: "READY_TO_SHIP" },
  READY_TO_SHIP: { label: "Kargoya Ver", target: "SHIPPED" },
  SHIPPED: { label: "Teslim Edildi", target: "DELIVERED" },
};

export const SHIPPING_COMPANIES = [
  "Yurtiçi Kargo",
  "Aras Kargo",
  "MNG Kargo",
  "Sürat Kargo",
  "PTT Kargo",
  "Hepsijet",
  "Trendyol Express",
  "Diğer",
] as const;

export function orderStatusTone(status: OrderStatus) {
  if (status === "CANCELLED") return "bg-red-50 text-red-700 ring-red-200";
  if (status === "RETURN_REQUESTED" || status === "RETURNED") return "bg-violet-50 text-violet-700 ring-violet-200";
  if (status === "DELIVERED" || status === "COMPLETED") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "SHIPPED") return "bg-sky-50 text-sky-700 ring-sky-200";
  if (status === "READY_TO_SHIP") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "PREPARING") return "bg-indigo-50 text-indigo-700 ring-indigo-200";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}
