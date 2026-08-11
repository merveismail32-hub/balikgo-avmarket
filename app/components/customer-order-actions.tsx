"use client";
import { useState } from "react";
import type { OrderStatus } from "@prisma/client";

export function CustomerOrderActions({ itemId, status }: { itemId: string; status: OrderStatus }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const canCancel = status === "NEW" || status === "PREPARING";
  const canReturn = status === "DELIVERED" || status === "COMPLETED";
  if (!canCancel && !canReturn) return null;
  async function submit(action: "CANCEL" | "REQUEST_RETURN") {
    const reason = action === "REQUEST_RETURN" ? window.prompt("İade sebebinizi en az 10 karakterle açıklayın:")?.trim() : undefined;
    if (action === "REQUEST_RETURN" && (!reason || reason.length < 10)) return;
    if (action === "CANCEL" && !window.confirm("Bu ürün kalemini iptal etmek istediğinize emin misiniz?")) return;
    setBusy(true); setMessage("");
    try { const response = await fetch(`/api/orders/items/${itemId}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(reason ? { reason } : {}) }) }); const body = await response.json().catch(() => ({})) as { error?: string }; setMessage(response.ok ? "İşleminiz alındı. Sayfayı yenileyebilirsiniz." : body.error ?? "İşlem tamamlanamadı."); } finally { setBusy(false); }
  }
  return <div className="mt-2"><button type="button" disabled={busy} onClick={() => void submit(canCancel ? "CANCEL" : "REQUEST_RETURN")} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-sky-700 disabled:opacity-50">{busy ? "İşleniyor..." : canCancel ? "Ürünü İptal Et" : "İade Talebi Oluştur"}</button>{message && <p role="status" className="mt-2 text-xs text-slate-600">{message}</p>}</div>;
}
