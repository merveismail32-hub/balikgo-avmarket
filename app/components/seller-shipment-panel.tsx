"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ShipmentStatus } from "@prisma/client";
import { CARRIERS, SHIPMENT_STATUS_LABELS } from "@/app/lib/shipping";

type Shipment = { id: string; status: ShipmentStatus; carrierCode: string | null; carrierName: string | null; trackingNumber: string | null; itemCount: number };

export function SellerShipmentPanel({ orderId, initialShipments }: { orderId: string; initialShipments: Shipment[] }) {
  const router = useRouter();
  const [shipments, setShipments] = useState(initialShipments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [carrierCode, setCarrierCode] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");

  async function createPackage() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/seller/shipments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) });
      const body = await response.json() as Shipment & { error?: string };
      if (!response.ok) return setError(body.error ?? "Paket oluşturulamadı.");
      setShipments((current) => current.some((item) => item.id === body.id) ? current : [...current, { ...body, carrierCode: null, carrierName: null, trackingNumber: null, itemCount: 0 }]);
      router.refresh();
    } finally { setBusy(false); }
  }

  async function update(shipment: Shipment, status: ShipmentStatus) {
    setBusy(true); setError("");
    try {
      const payload = status === "SHIPPED" ? { status, carrierCode, trackingNumber: trackingNumber.trim() } : { status };
      const response = await fetch(`/api/seller/shipments/${shipment.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { error?: string };
      if (!response.ok) return setError(body.error ?? "Paket güncellenemedi.");
      const carrier = CARRIERS.find((item) => item.code === carrierCode);
      setShipments((current) => current.map((item) => item.id === shipment.id ? { ...item, status, ...(status === "SHIPPED" ? { carrierCode, carrierName: carrier?.displayName ?? null, trackingNumber: trackingNumber.trim() } : {}) } : item));
      router.refresh();
    } finally { setBusy(false); }
  }

  const next = (status: ShipmentStatus) => status === "NOT_READY" ? "PREPARING" : status === "PREPARING" ? "READY_TO_SHIP" : status === "READY_TO_SHIP" ? "SHIPPED" : status === "SHIPPED" ? "DELIVERED" : null;
  return <section className="mb-5 rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black tracking-wider text-sky-600">PAKET OPERASYONU</p><h2 className="mt-1 text-lg font-black">Gönderi paketleri</h2></div>{!shipments.length && <button disabled={busy} onClick={() => void createPackage()} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50">Siparişi Hazırla</button>}</div><div className="mt-4 space-y-4">{shipments.map((shipment, index) => { const target = next(shipment.status); return <article key={shipment.id} className="rounded-xl border bg-slate-50 p-4"><div className="flex flex-wrap justify-between gap-2"><b>Paket {index + 1}</b><span className="text-sm font-bold text-sky-700">{SHIPMENT_STATUS_LABELS[shipment.status]}</span></div>{shipment.carrierName && <p className="mt-2 break-all text-sm">{shipment.carrierName} · Takip: {shipment.trackingNumber}</p>}{target === "SHIPPED" && <div className="mt-4 grid gap-3 sm:grid-cols-2"><select aria-label="Kargo firması" value={carrierCode} onChange={(event) => setCarrierCode(event.target.value)} className="rounded-xl border bg-white p-3"><option value="">Kargo firması seçin</option>{CARRIERS.map((carrier) => <option key={carrier.code} value={carrier.code}>{carrier.displayName}</option>)}</select><input aria-label="Takip numarası" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} maxLength={80} placeholder="Takip numarası" className="min-w-0 rounded-xl border p-3" /></div>}{target && <button disabled={busy || (target === "SHIPPED" && (!carrierCode || trackingNumber.trim().length < 3))} onClick={() => void update(shipment, target)} className="mt-4 min-h-11 rounded-xl bg-sky-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{target === "PREPARING" ? "Hazırlamaya Başla" : target === "READY_TO_SHIP" ? "Paket Hazır" : target === "SHIPPED" ? "Kargoya Verildi Olarak İşaretle" : "Teslim Edildi"}</button>}</article>; })}</div>{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}</section>;
}
