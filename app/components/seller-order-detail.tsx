"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { OrderStatus } from "@prisma/client";
import { formatPrice } from "@/app/lib/products";
import { ORDER_STATUS_LABELS, orderStatusTone, SELLER_CANCELLABLE_STATUSES, SELLER_ORDER_TRANSITIONS, SHIPPING_COMPANIES } from "@/app/lib/order-status";

type History = { id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; createdAt: Date | string };
type Item = { id: string; productName: string; productSku: string | null; productImageUrl: string; unitPrice: number; quantity: number; commissionAmount: number | null; sellerNetAmount: number | null; status: OrderStatus; shippingCompany: string | null; trackingNumber: string | null; createdAt: Date | string; statusHistory: History[] };
type OrderView = { id: string; orderNumber: string; recipientName: string; phone: string; city: string; district: string; address: string; postalCode: string | null; createdAt: Date | string; items: Item[] };

export function SellerOrderDetail({ order }: { order: OrderView }) {
  const [items, setItems] = useState(order.items);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [shippingId, setShippingId] = useState<string | null>(null);
  const [company, setCompany] = useState("");
  const [tracking, setTracking] = useState("");

  async function update(item: Item, status: OrderStatus, shippingCompany?: string, trackingNumber?: string) {
    setBusyId(item.id); setError("");
    try {
      const response = await fetch(`/api/seller/orders/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, shippingCompany, trackingNumber }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(body.error ?? "Sipariş güncellenemedi."); return; }
      setItems((current) => current.map((value) => value.id !== item.id ? value : ({ ...value, status, shippingCompany: shippingCompany ?? value.shippingCompany, trackingNumber: trackingNumber ?? value.trackingNumber, statusHistory: status === value.status ? value.statusHistory : [...value.statusHistory, { id: `local-${Date.now()}`, fromStatus: value.status, toStatus: status, createdAt: new Date() }] })));
      setShippingId(null);
    } finally { setBusyId(null); }
  }

  return <div className="max-w-6xl">
    <Link href="/satici-panel/siparisler" className="text-sm font-black text-sky-600">← Siparişlere dön</Link>
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="space-y-5">
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-black tracking-wider text-sky-600">SİPARİŞ ÖZETİ</p><h2 className="mt-1 text-xl font-black">{order.orderNumber}</h2><p className="mt-1 text-sm text-slate-500">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short" }).format(new Date(order.createdAt))}</p></div>
        {items.map((item) => {
          const transition = SELLER_ORDER_TRANSITIONS[item.status];
          return <article key={item.id} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex gap-4"><div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100"><Image src={item.productImageUrl} alt={item.productName} fill className="object-contain p-2" /></div><div><h3 className="font-black">{item.productName}</h3><p className="mt-1 text-xs text-slate-500">SKU: {item.productSku ?? "—"}</p><p className="mt-2 text-sm">{item.quantity} adet · {formatPrice(item.unitPrice)} · <b>{formatPrice(item.unitPrice * item.quantity)}</b></p></div></div><span className={`rounded-full px-3 py-2 text-xs font-black ring-1 ${orderStatusTone(item.status)}`}>{ORDER_STATUS_LABELS[item.status]}</span></div>
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-xs"><span>Brüt<br /><b>{formatPrice(item.unitPrice * item.quantity)}</b></span><span>Komisyon<br /><b>{item.commissionAmount == null ? "—" : formatPrice(item.commissionAmount)}</b></span><span>Hakediş<br /><b>{item.sellerNetAmount == null ? "—" : formatPrice(item.sellerNetAmount)}</b></span></div>{item.shippingCompany && <p className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-800"><b>{item.shippingCompany}</b> · Takip no: {item.trackingNumber}</p>}
            <div className="mt-4 flex flex-wrap gap-2">{transition && (transition.target === "SHIPPED" ? <button disabled={busyId === item.id} onClick={() => { setShippingId(item.id); setCompany(""); setTracking(""); setError(""); }} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">Kargoya Ver</button> : <button disabled={busyId === item.id} onClick={() => void update(item, transition.target)} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{transition.label}</button>)}{SELLER_CANCELLABLE_STATUSES.includes(item.status) && <button disabled={busyId === item.id} onClick={() => window.confirm("Bu ürün kalemini iptal etmek istediğinize emin misiniz? Stok bir kez iade edilecektir.") && void update(item, "CANCELLED")} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-black text-red-700 disabled:opacity-50">İptal Et</button>}</div>
            <ol className="mt-5 space-y-2 border-t pt-4">{item.statusHistory.map((history) => <li key={history.id} className="text-xs text-slate-500"><b className="text-slate-700">{ORDER_STATUS_LABELS[history.toStatus]}</b> · {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(history.createdAt))}</li>)}</ol>
          </article>;
        })}
      </section>
      <aside className="h-fit rounded-2xl border bg-white p-5 shadow-sm xl:sticky xl:top-5"><h3 className="font-black">Müşteri ve teslimat</h3><p className="mt-4 text-sm leading-6 text-slate-600"><b className="text-slate-900">{order.recipientName}</b><br />{order.phone}<br />{order.address}<br />{order.district} / {order.city}{order.postalCode ? ` · ${order.postalCode}` : ""}</p><p className="mt-5 border-t pt-4 text-sm font-black">Mağaza toplamı: {formatPrice(items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0))}</p>{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}</aside>
    </div>
    {shippingId && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-5"><div className="w-full max-w-md rounded-2xl bg-white p-6"><h2 className="text-xl font-black">Kargoya ver</h2><label className="mt-5 block text-sm font-bold">Kargo firması *<select value={company} onChange={(event) => setCompany(event.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="">Seçiniz</option>{SHIPPING_COMPANIES.map((value) => <option key={value}>{value}</option>)}</select></label><label className="mt-4 block text-sm font-bold">Takip numarası *<input value={tracking} onChange={(event) => setTracking(event.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label><div className="mt-6 flex gap-3"><button onClick={() => setShippingId(null)} className="flex-1 rounded-xl border py-3 text-sm font-black">Vazgeç</button><button disabled={!company || tracking.trim().length < 3 || busyId === shippingId} onClick={() => { const item = items.find((value) => value.id === shippingId); if (item) void update(item, "SHIPPED", company, tracking.trim()); }} className="flex-1 rounded-xl bg-sky-600 py-3 text-sm font-black text-white disabled:opacity-50">Kargoya Ver</button></div></div></div>}
  </div>;
}
