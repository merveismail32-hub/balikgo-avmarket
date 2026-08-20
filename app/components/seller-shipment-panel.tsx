"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ShipmentStatus } from "@prisma/client";
import { CARRIERS, shipmentStatusLabel, trackingUrlFor, validateTrackingNumber } from "@/app/lib/shipping";

type Item = { id: string; productName: string; productSku: string | null; quantity: number };
type Shipment = {
  id: string; status: ShipmentStatus; carrierCode: string | null; carrierName: string | null; trackingNumber: string | null;
  items: { quantity: number; orderItem: Pick<Item, "id" | "productName" | "productSku"> }[];
  events: { id: string; status: ShipmentStatus; eventTime: string; location: string | null; description: string | null }[];
};
type TrackingDraft = { carrierCode: string; trackingNumber: string };

const nextSellerStatus = (status: ShipmentStatus): ShipmentStatus | null => status === "NOT_READY" ? "PREPARING" : status === "PREPARING" ? "READY_TO_SHIP" : status === "READY_TO_SHIP" ? "SHIPPED" : null;
const actionLabel = (status: ShipmentStatus) => status === "PREPARING" ? "Hazırlamaya başla" : status === "READY_TO_SHIP" ? "Kargoya hazır" : "Kargoya verildi olarak işaretle";

export function SellerShipmentPanel({ orderId, initialShipments, initialAvailableItems }: { orderId: string; initialShipments: Shipment[]; initialAvailableItems: Item[] }) {
  const router = useRouter();
  const [shipments, setShipments] = useState(initialShipments);
  const [availableItems, setAvailableItems] = useState(initialAvailableItems);
  const [selectedIds, setSelectedIds] = useState(() => initialAvailableItems.map((item) => item.id));
  const [drafts, setDrafts] = useState<Record<string, TrackingDraft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const draftFor = (shipment: Shipment) => drafts[shipment.id] ?? { carrierCode: shipment.carrierCode ?? "", trackingNumber: shipment.trackingNumber ?? "" };
  const setDraft = (id: string, value: Partial<TrackingDraft>) => setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? { carrierCode: "", trackingNumber: "" }), ...value } }));

  async function createPackage() {
    const chosen = availableItems.filter((item) => selectedIds.includes(item.id)); if (!chosen.length) return;
    setBusy("create"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/seller/shipments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, orderItemIds: chosen.map((item) => item.id) }) });
      const body = await response.json().catch(() => ({})) as { id?: string; status?: ShipmentStatus; error?: string };
      if (!response.ok || !body.id || !body.status) return setError(body.error ?? "Paket oluşturulamadı. Sayfayı yenileyip tekrar deneyin.");
      setShipments((current) => current.some((item) => item.id === body.id) ? current : [...current, { id: body.id!, status: body.status!, carrierCode: null, carrierName: null, trackingNumber: null, items: chosen.map((item) => ({ quantity: item.quantity, orderItem: item })), events: [] }]);
      setAvailableItems((current) => current.filter((item) => !selectedIds.includes(item.id))); setSelectedIds([]); setMessage("Paket oluşturuldu."); router.refresh();
    } catch { setError("Ağ bağlantısı nedeniyle paket oluşturulamadı. Tekrar deneyin."); } finally { setBusy(null); }
  }

  async function update(shipment: Shipment, status: ShipmentStatus) {
    const draft = draftFor(shipment); setBusy(shipment.id); setError(""); setMessage("");
    try {
      const payload = status === "SHIPPED" ? { status, carrierCode: draft.carrierCode, trackingNumber: draft.trackingNumber.trim() } : { status };
      const response = await fetch(`/api/seller/shipments/${shipment.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string; idempotent?: boolean };
      if (!response.ok) return setError(response.status === 409 ? "Paket başka bir işlemle güncellendi veya bu geçiş artık uygun değil. Sayfayı yenileyin." : body.error ?? "Paket güncellenemedi.");
      const carrier = CARRIERS.find((item) => item.code === draft.carrierCode);
      setShipments((current) => current.map((item) => item.id === shipment.id ? { ...item, status, ...(status === "SHIPPED" ? { carrierCode: draft.carrierCode, carrierName: carrier?.displayName ?? null, trackingNumber: draft.trackingNumber.trim() } : {}) } : item));
      setMessage(body.idempotent ? "Paket zaten bu durumdaydı; bilgiler güncel." : "Paket durumu güncellendi."); router.refresh();
    } catch { setError("Ağ bağlantısı nedeniyle paket güncellenemedi. Tekrar deneyin."); } finally { setBusy(null); }
  }

  return <section className="mb-5 rounded-2xl border bg-white p-5 shadow-sm">
    <div><p className="text-xs font-black tracking-wider text-sky-600">PAKET OPERASYONU</p><h2 className="mt-1 text-lg font-black">Gönderi paketleri</h2><p className="mt-1 text-sm text-slate-500">Ürünleri paketlere ayırın; kargoya verirken firma ve takip numarasını ekleyin.</p></div>
    {availableItems.length > 0 && <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50/50 p-4"><h3 className="font-black">Yeni paket oluştur</h3><div className="mt-3 space-y-2">{availableItems.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-lg bg-white p-3 text-sm"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} className="mt-1" /><span><b>{item.productName}</b><span className="block text-xs text-slate-500">SKU: {item.productSku ?? "—"} · {item.quantity} adet</span></span></label>)}</div><button disabled={busy !== null || selectedIds.length === 0} onClick={() => void createPackage()} className="mt-3 rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{busy === "create" ? "Oluşturuluyor…" : "Seçilenlerle paket oluştur"}</button></div>}
    <div className="mt-5 space-y-4">{shipments.map((shipment, index) => { const target = nextSellerStatus(shipment.status); const draft = draftFor(shipment); const trackingValid = validateTrackingNumber(draft.trackingNumber); const preview = draft.carrierCode && trackingValid ? trackingUrlFor(draft.carrierCode, draft.trackingNumber) : null; return <article key={shipment.id} className="rounded-xl border bg-slate-50 p-4"><div className="flex flex-wrap justify-between gap-2"><b>Paket {index + 1}</b><span className="text-sm font-bold text-sky-700">{shipmentStatusLabel(shipment.status)}</span></div><p className="mt-3 text-sm text-slate-600">{shipment.items.map((item) => `${item.orderItem.productName} (${item.quantity} adet)`).join(", ")}</p>{shipment.carrierName && <p className="mt-2 break-all text-sm"><b>{shipment.carrierName}</b> · Takip: {shipment.trackingNumber}</p>}{target === "SHIPPED" && <div className="mt-4 grid gap-3 sm:grid-cols-2"><select aria-label={`Paket ${index + 1} kargo firması`} value={draft.carrierCode} onChange={(event) => setDraft(shipment.id, { carrierCode: event.target.value })} className="rounded-xl border bg-white p-3"><option value="">Kargo firması seçin</option>{CARRIERS.map((carrier) => <option key={carrier.code} value={carrier.code}>{carrier.displayName}</option>)}</select><input aria-label={`Paket ${index + 1} takip numarası`} value={draft.trackingNumber} onChange={(event) => setDraft(shipment.id, { trackingNumber: event.target.value })} maxLength={80} placeholder="Takip numarası" className="min-w-0 rounded-xl border p-3" />{draft.trackingNumber && !trackingValid && <p className="text-xs font-bold text-red-700 sm:col-span-2">Takip numarası 3–80 karakter olmalı ve yalnızca harf, rakam, nokta, tire, alt çizgi veya / içermelidir.</p>}{preview && <a href={preview} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-sky-700 sm:col-span-2">Güvenli takip bağlantısını önizle ↗</a>}</div>}{target && <button disabled={busy !== null || (target === "SHIPPED" && (!draft.carrierCode || !trackingValid))} onClick={() => void update(shipment, target)} className="mt-4 min-h-11 rounded-xl bg-sky-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{busy === shipment.id ? "Güncelleniyor…" : actionLabel(target)}</button>}{!target && ["SHIPPED", "HANDED_TO_CARRIER", "IN_TRANSIT", "AT_TRANSFER_CENTER", "OUT_FOR_DELIVERY", "AT_PICKUP_POINT"].includes(shipment.status) && <p className="mt-4 rounded-lg bg-white p-3 text-xs font-semibold text-slate-500">Sonraki taşıma durumları kargo olaylarıyla güncellenir.</p>}{shipment.events.length > 0 && <ol className="mt-4 space-y-2 border-t pt-4">{shipment.events.map((event) => <li key={event.id} className="text-sm"><b>{shipmentStatusLabel(event.status)}</b> · {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.eventTime))}{event.location ? ` · ${event.location}` : ""}{event.description ? <p className="text-slate-500">{event.description}</p> : null}</li>)}</ol>}</article>; })}</div>
    {message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</p>}{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
  </section>;
}
