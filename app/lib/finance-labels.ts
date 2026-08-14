import type { PaymentStatus, PayoutStatus, RefundStatus } from "@prisma/client";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { PENDING: "Ödeme Bekleniyor", AUTHORIZED: "Ödeme Onaylandı", PAID: "Ödendi", FAILED: "Ödeme Başarısız", CANCELLED: "Ödeme İptal Edildi", PARTIALLY_REFUNDED: "Kısmi İade", REFUNDED: "İade Edildi", REFUND_PENDING: "İade Bekleniyor", PARTIAL_REFUND_PENDING: "Kısmi İade Bekleniyor" };
export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = { PENDING: "Bekliyor", BLOCKED: "Blokeli", AVAILABLE: "Hakedişe Uygun", SCHEDULED: "Planlandı", PAID: "Ödendi", CANCELLED: "İptal Edildi" };
export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = { REQUESTED: "Talep Alındı", APPROVED: "Onaylandı", PROCESSING: "İşleniyor", COMPLETED: "Tamamlandı", REJECTED: "Reddedildi", FAILED: "Başarısız", CANCELLED: "İptal Edildi" };
