"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Product } from "@prisma/client";
import { formatPrice } from "@/app/lib/products";

type Tab = "all" | "active" | "inactive" | "out-of-stock";

function cover(product: Product) {
  return product.imageUrl || (Array.isArray(product.images) && typeof product.images[0] === "string" ? product.images[0] : "");
}

function searchable(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const moderationLabels = { PENDING: "Onay bekliyor", APPROVED: "Onaylandı", REJECTED: "Reddedildi", SUSPENDED: "Askıya alındı" } as const;

export function SellerProductsTable({ initialProducts }: { initialProducts: Product[] }) {
  const [products, setProducts] = useState(initialProducts);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [stock, setStock] = useState("all");
  const [tab, setTab] = useState<Tab>("all");

  const categories = useMemo(() => [...new Set(products.map((product) => product.category))].sort((a, b) => a.localeCompare(b, "tr-TR")), [products]);
  const counts = {
    all: products.length,
    active: products.filter((product) => product.active).length,
    inactive: products.filter((product) => !product.active).length,
    "out-of-stock": products.filter((product) => product.stock === 0).length,
  };
  const filtered = useMemo(() => {
    const normalizedQuery = searchable(query.trim());
    return products.filter((product) => {
      const matchesTab = tab === "all" || (tab === "active" && product.active) || (tab === "inactive" && !product.active) || (tab === "out-of-stock" && product.stock === 0);
      const matchesQuery = !normalizedQuery || [product.name, product.sku ?? "", product.brand].some((value) => searchable(value).includes(normalizedQuery));
      const matchesCategory = category === "all" || product.category === category;
      const matchesStatus = status === "all" || (status === "active" ? product.active : !product.active);
      const matchesStock = stock === "all" || (stock === "in-stock" ? product.stock > 0 : product.stock === 0);
      return matchesTab && matchesQuery && matchesCategory && matchesStatus && matchesStock;
    });
  }, [category, products, query, status, stock, tab]);

  async function patch(id: string, body: object, successText: string) {
    setBusy(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/seller/products/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Ürün güncellenemedi.");
      setProducts((current) => current.map((product) => product.id === id ? { ...product, ...body } : product));
      setMessage({ tone: "success", text: successText });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Ürün güncellenemedi." });
    } finally {
      setBusy(null);
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "Tümü" },
    { key: "active", label: "Aktif" },
    { key: "inactive", label: "Pasif" },
    { key: "out-of-stock", label: "Stokta Yok" },
  ];

  return <div className="space-y-5">
    <div className="flex gap-2 overflow-x-auto border-b">
      {tabs.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-bold transition ${tab === item.key ? "border-sky-500 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-900"}`}>{item.label} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{counts[item.key]}</span></button>)}
    </div>

    <div className="grid gap-3 rounded-2xl border bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-4">
      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Arama<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ürün adı, SKU veya marka" className="mt-2 w-full rounded-xl border px-4 py-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-sky-500" /></label>
      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Kategori<select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-sky-500"><option value="all">Tüm kategoriler</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Durum<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-sky-500"><option value="all">Tüm durumlar</option><option value="active">Aktif</option><option value="inactive">Pasif</option></select></label>
      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Stok<select value={stock} onChange={(event) => setStock(event.target.value)} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-sky-500"><option value="all">Tüm stoklar</option><option value="in-stock">Stokta</option><option value="out-of-stock">Stokta yok</option></select></label>
    </div>

    {message && <p role="status" className={`rounded-xl px-4 py-3 text-sm font-bold ${message.tone === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{message.text}</p>}

    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-4">Ürün</th><th className="px-5 py-4">SKU</th><th className="px-5 py-4">Kategori</th><th className="px-5 py-4">Fiyat</th><th className="px-5 py-4">Stok</th><th className="px-5 py-4">Yayın</th><th className="px-5 py-4">Moderasyon</th><th className="px-5 py-4 text-right">İşlemler</th></tr></thead>
          <tbody>{filtered.map((product) => {
            const image = cover(product);
            return <tr key={product.id} className="border-t align-middle">
              <td className="px-5 py-4"><div className="flex items-center gap-3">{image ? <div className="relative h-14 w-14 overflow-hidden rounded-lg bg-slate-50"><Image src={image} alt={product.name} fill className="object-contain p-1" /></div> : <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">Görsel</div>}<div><p className="max-w-56 font-bold">{product.name}</p><p className="mt-1 text-xs text-slate-400">{product.brand}</p></div></div></td>
              <td className="px-5 py-4 font-mono text-xs font-bold text-slate-600">{product.sku ?? "—"}</td>
              <td className="px-5 py-4">{product.category}</td>
              <td className="px-5 py-4 font-black">{formatPrice(Number(product.price))}</td>
              <td className={`px-5 py-4 font-bold ${product.stock === 0 ? "text-red-600" : "text-slate-800"}`}>{product.stock === 0 ? "Stokta yok" : `${product.stock} adet`}</td>
              <td className="px-5 py-4"><span className={product.active ? "rounded-full bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700" : "rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"}>{product.active ? "Aktif" : "Pasif"}</span></td>
              <td className="px-5 py-4"><span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800">{moderationLabels[product.moderationStatus]}</span>{product.moderationReason && <p className="mt-2 max-w-52 text-xs text-red-700">{product.moderationReason}</p>}</td>
              <td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><Link href={`/satici-panel/urunler/${product.id}/duzenle`} className="rounded-lg px-3 py-2 text-xs font-bold text-sky-600 hover:bg-sky-50">Düzenle</Link><button disabled={busy === product.id} onClick={() => patch(product.id, { active: !product.active }, product.active ? "Ürün yayından kaldırıldı." : "Ürün yayına alındı.")} className="rounded-lg border px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{busy === product.id ? "Kaydediliyor..." : product.active ? "Yayından Kaldır" : "Yayına Al"}</button></div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!filtered.length && <div className="px-6 py-14 text-center"><p className="font-bold text-slate-700">Eşleşen ürün bulunamadı.</p><p className="mt-2 text-sm text-slate-500">Arama veya filtre seçimlerinizi değiştirebilirsiniz.</p></div>}
    </div>
  </div>;
}
