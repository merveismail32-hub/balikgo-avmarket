"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Order, OrderItem, OrderStatus, User } from "@prisma/client";
import { formatPrice } from "@/app/lib/products";
import { ORDER_STATUS_LABELS, orderStatusTone, SELLER_ORDER_TRANSITIONS, SHIPPING_COMPANIES } from "@/app/lib/order-status";

type Item = OrderItem & { order: Order & { user: Pick<User, "name" | "surname"> } };
type Tab = "ALL" | "NEW" | "PREPARING" | "READY_TO_SHIP" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "RETURN";
const tabs: { key: Tab; label: string }[] = [
  { key: "ALL", label: "Tümü" }, { key: "NEW", label: "Yeni" }, { key: "PREPARING", label: "Hazırlanıyor" },
  { key: "READY_TO_SHIP", label: "Kargoya Hazır" }, { key: "SHIPPED", label: "Kargolandı" },
  { key: "DELIVERED", label: "Teslim Edildi" }, { key: "CANCELLED", label: "İptal" }, { key: "RETURN", label: "İade" },
];

function isInTab(item: Item, tab: Tab) {
  if (tab === "ALL") return true;
  if (tab === "DELIVERED") return item.status === "DELIVERED" || item.status === "COMPLETED";
  if (tab === "RETURN") return item.status === "RETURN_REQUESTED" || item.status === "RETURNED";
  return item.status === tab;
}

export function SellerOrdersTable({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<Tab>("ALL");
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [ship, setShip] = useState<Item | null>(null);
  const [company, setCompany] = useState("");
  const [tracking, setTracking] = useState("");
  const [error, setError] = useState("");

  const filtered = useMemo(() => items.filter((item) => {
    const haystack = `${item.order.orderNumber} ${item.productName} ${item.order.user.name} ${item.order.user.surname}`.toLocaleLowerCase("tr-TR");
    return isInTab(item, tab) && haystack.includes(query.trim().toLocaleLowerCase("tr-TR")) && (!carrier || item.shippingCompany === carrier);
  }), [items, tab, query, carrier]);

  async function update(item: Item, status: OrderStatus, shippingCompany?: string, trackingNumber?: string) {
    setBusy(item.id); setError("");
    try {
      const response = await fetch(`/api/seller/orders/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, shippingCompany, trackingNumber }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(body.error ?? "Sipariş güncellenemedi."); return; }
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status, shippingCompany: shippingCompany ?? candidate.shippingCompany, trackingNumber: trackingNumber ?? candidate.trackingNumber } : candidate));
      setShip(null);
    } finally { setBusy(null); }
  }

  function action(item: Item) {
    const transition = SELLER_ORDER_TRANSITIONS[item.status];
    if (!transition) return null;
    if (transition.target === "SHIPPED") return <button disabled={busy === item.id} onClick={() => { setError(""); setCompany(""); setTracking(""); setShip(item); }} className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Kargoya Ver</button>;
    return <button disabled={busy === item.id} onClick={() => void update(item, transition.target)} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{busy === item.id ? "Kaydediliyor..." : transition.label}</button>;
  }

  return <>
    <section className="rounded-2xl border bg-white shadow-sm">
      <div className="border-b p-4 sm:p-5"><div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><h2 className="text-lg font-black">Sipariş operasyon merkezi</h2><p className="mt-1 text-sm text-slate-500">Duruma göre filtreleyin ve yalnızca geçerli operasyon aksiyonlarını uygulayın.</p></div><div className="grid gap-2 sm:grid-cols-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sipariş no, ürün veya müşteri" className="min-w-0 rounded-xl border px-3 py-2.5 text-sm outline-none ring-sky-200 focus:ring-2" /><select value={carrier} onChange={(event) => setCarrier(event.target.value)} className="rounded-xl border px-3 py-2.5 text-sm"><option value="">Tüm kargo firmaları</option>{SHIPPING_COMPANIES.map((value) => <option key={value}>{value}</option>)}</select></div></div></div>
      <div className="flex gap-2 overflow-x-auto border-b px-4 py-3 sm:px-5">{tabs.map((entry) => { const count = items.filter((item) => isInTab(item, entry.key)).length; return <button key={entry.key} onClick={() => setTab(entry.key)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${tab === entry.key ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{entry.label} <span className="opacity-75">({count})</span></button>; })}</div>
      <div className="divide-y">{filtered.length ? filtered.map((item) => <article key={item.id} className="flex flex-col gap-4 p-4 transition hover:bg-slate-50 sm:p-5 lg:grid lg:grid-cols-[72px_minmax(0,1.5fr)_minmax(150px,.8fr)_auto] lg:items-center"><div className="relative h-16 w-16 overflow-hidden rounded-xl bg-slate-100"><Image src={item.productImageUrl} alt={item.productName} fill sizes="64px" className="object-contain p-1" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><b className="text-sm">{item.order.orderNumber}</b><span className="text-xs text-slate-400">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</span></div><p className="mt-1 truncate font-bold">{item.productName}</p><p className="mt-1 text-sm text-slate-500">{item.order.user.name} {item.order.user.surname} · {item.quantity} adet · {formatPrice(Number(item.unitPrice) * item.quantity)}</p>{item.status === "SHIPPED" && <p className="mt-1 text-xs font-semibold text-sky-700">{item.shippingCompany} · Takip: {item.trackingNumber}</p>}</div><div><span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black ring-1 ${orderStatusTone(item.status)}`}>{ORDER_STATUS_LABELS[item.status]}</span></div><div className="flex flex-wrap gap-2 lg:justify-end">{action(item)}<Link href={`/satici-panel/siparisler/${item.id}`} className="rounded-xl border px-3 py-2 text-xs font-black text-slate-700 hover:bg-white">Detay</Link></div></article>) : <div className="p-10 text-center"><p className="font-black">Bu filtrelerle eşleşen sipariş yok.</p><button onClick={() => { setTab("ALL"); setQuery(""); setCarrier(""); }} className="mt-3 text-sm font-bold text-sky-600">Filtreleri temizle</button></div>}</div>
    </section>
    {error && !ship && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
    {ship && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-5"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><p className="text-sm font-bold text-sky-600">KARGO OPERASYONU</p><h2 className="mt-1 text-xl font-black">Kargoya ver</h2><p className="mt-2 text-sm text-slate-500">{ship.order.orderNumber} · {ship.productName}</p><label className="mt-5 block text-sm font-bold">Kargo firması *<select value={company} onChange={(event) => setCompany(event.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="">Seçiniz</option>{SHIPPING_COMPANIES.map((value) => <option key={value}>{value}</option>)}</select></label><label className="mt-4 block text-sm font-bold">Takip numarası *<input value={tracking} onChange={(event) => setTracking(event.target.value)} className="mt-2 w-full rounded-xl border p-3" placeholder="Takip numarasını girin" /></label>{error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}<div className="mt-6 flex gap-3"><button disabled={busy === ship.id} onClick={() => setShip(null)} className="flex-1 rounded-xl border py-3 text-sm font-black">Vazgeç</button><button disabled={!company.trim() || !tracking.trim() || busy === ship.id} onClick={() => void update(ship, "SHIPPED", company.trim(), tracking.trim())} className="flex-1 rounded-xl bg-sky-600 py-3 text-sm font-black text-white disabled:opacity-50">{busy === ship.id ? "Kaydediliyor..." : "Kargoya Ver"}</button></div></div></div>}
  </>;
}
