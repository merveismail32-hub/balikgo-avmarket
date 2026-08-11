import Image from "next/image";
import Link from "next/link";
import type { OrderStatus } from "@prisma/client";
import { formatPrice } from "@/app/lib/products";
import { ORDER_STATUS_LABELS, orderStatusTone, SHIPPING_COMPANIES } from "@/app/lib/order-status";

export type SellerOrderRow = {
  id: string;
  orderNumber: string;
  createdAt: Date;
  customerName: string;
  items: { id: string; productName: string; productSku: string | null; productImageUrl: string; unitPrice: number; quantity: number; status: OrderStatus; shippingCompany: string | null; trackingNumber: string | null }[];
};

type Filters = { q: string; status: string; carrier: string; from: string; to: string };

const tabs = [
  ["", "Tümü"], ["NEW", "Yeni"], ["PREPARING", "Hazırlanıyor"], ["READY_TO_SHIP", "Kargoya Hazır"],
  ["SHIPPED", "Kargolandı"], ["DELIVERED", "Teslim Edildi"], ["CANCELLED", "İptal"],
] as const;

function filterUrl(filters: Filters, status: string, page = 1) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (status) params.set("status", status);
  if (filters.carrier) params.set("carrier", filters.carrier);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/satici-panel/siparisler${query ? `?${query}` : ""}`;
}

function groupStatus(items: SellerOrderRow["items"]) {
  const unique = [...new Set(items.map((item) => item.status))];
  return unique.length === 1 ? unique[0] : null;
}

export function SellerOrdersTable({ orders, counts, filters, page, totalPages }: { orders: SellerOrderRow[]; counts: Partial<Record<OrderStatus, number>>; filters: Filters; page: number; totalPages: number }) {
  const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
  const countFor = (status: string) => status ? status === "DELIVERED" ? (counts.DELIVERED ?? 0) + (counts.COMPLETED ?? 0) : counts[status as OrderStatus] ?? 0 : total;

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{tabs.slice(1).map(([status, label]) => <div key={status} className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-black">{countFor(status)}</p></div>)}</div>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <form className="grid gap-3 border-b p-4 md:grid-cols-2 xl:grid-cols-5" action="/satici-panel/siparisler">
        <input name="q" defaultValue={filters.q} placeholder="Sipariş no, müşteri, ürün, SKU, takip no" className="rounded-xl border px-4 py-3 text-sm outline-none focus:border-sky-500 xl:col-span-2" />
        <select name="carrier" defaultValue={filters.carrier} className="rounded-xl border bg-white px-4 py-3 text-sm"><option value="">Tüm kargolar</option>{SHIPPING_COMPANIES.map((carrier) => <option key={carrier}>{carrier}</option>)}</select>
        <input name="from" type="date" defaultValue={filters.from} aria-label="Başlangıç tarihi" className="rounded-xl border px-4 py-3 text-sm" />
        <div className="flex gap-2"><input name="to" type="date" defaultValue={filters.to} aria-label="Bitiş tarihi" className="min-w-0 flex-1 rounded-xl border px-3 py-3 text-sm" /><button className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">Filtrele</button></div>
      </form>
      <div className="flex gap-2 overflow-x-auto border-b px-4 py-3">{tabs.map(([status, label]) => <Link key={status || "all"} href={filterUrl(filters, status)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${filters.status === status ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label} ({countFor(status)})</Link>)}</div>
      <div className="divide-y">{orders.length ? orders.map((order) => {
        const status = groupStatus(order.items);
        const totalAmount = order.items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
        const first = order.items[0];
        return <article key={order.id} className="grid gap-4 p-5 lg:grid-cols-[72px_minmax(0,1.5fr)_minmax(170px,.8fr)_auto] lg:items-center">
          <div className="relative h-16 w-16 overflow-hidden rounded-xl bg-slate-100"><Image src={first.productImageUrl} alt={first.productName} fill sizes="64px" className="object-contain p-1" /></div>
          <div className="min-w-0"><div className="flex flex-wrap gap-3"><b>{order.orderNumber}</b><span className="text-xs text-slate-400">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(order.createdAt)}</span></div><p className="mt-1 font-bold">{order.customerName}</p><p className="mt-1 text-sm text-slate-500">{order.items.length} ürün kalemi · {order.items.reduce((sum, item) => sum + item.quantity, 0)} adet · {formatPrice(totalAmount)}</p><p className="mt-1 truncate text-xs text-slate-400">{order.items.map((item) => `${item.productName}${item.productSku ? ` (${item.productSku})` : ""}`).join(", ")}</p></div>
          <div>{status ? <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black ring-1 ${orderStatusTone(status)}`}>{ORDER_STATUS_LABELS[status]}</span> : <span className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-black text-violet-700 ring-1 ring-violet-200">Çoklu durum</span>}{order.items.some((item) => item.trackingNumber) && <p className="mt-2 text-xs font-semibold text-sky-700">Takip: {order.items.find((item) => item.trackingNumber)?.trackingNumber}</p>}</div>
          <Link href={`/satici-panel/siparisler/${order.id}`} className="rounded-xl border px-4 py-2.5 text-center text-xs font-black text-slate-700 hover:bg-slate-50">Detay</Link>
        </article>;
      }) : <div className="p-12 text-center"><p className="font-black">Bu filtrelerle eşleşen sipariş yok.</p><Link href="/satici-panel/siparisler" className="mt-3 inline-block text-sm font-bold text-sky-600">Filtreleri temizle</Link></div>}</div>
      {totalPages > 1 && <div className="flex items-center justify-between border-t px-5 py-4 text-sm"><span>Sayfa {page} / {totalPages}</span><div className="flex gap-2">{page > 1 && <Link href={filterUrl(filters, filters.status, page - 1)} className="rounded-lg border px-3 py-2 font-bold">← Önceki</Link>}{page < totalPages && <Link href={filterUrl(filters, filters.status, page + 1)} className="rounded-lg border px-3 py-2 font-bold">Sonraki →</Link>}</div></div>}
    </section>
  </div>;
}
