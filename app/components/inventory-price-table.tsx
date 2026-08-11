"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type InventoryProduct = {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  stock: number;
  active: boolean;
};

type Draft = { price: string; stock: string };

export function InventoryPriceTable({ initialProducts }: { initialProducts: InventoryProduct[] }) {
  const [products, setProducts] = useState(initialProducts);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(initialProducts.map((product) => [product.id, { price: String(product.price), stock: String(product.stock) }])));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { tone: "error" | "success"; text: string }>>({});
  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("tr-TR");
    return products.filter((product) => !value || product.name.toLocaleLowerCase("tr-TR").includes(value) || product.sku?.toLocaleLowerCase("tr-TR").includes(value));
  }, [products, query]);

  function updateDraft(id: string, key: keyof Draft, value: string) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
    setMessages((current) => { const next = { ...current }; delete next[id]; return next; });
  }

  async function save(product: InventoryProduct) {
    const draft = drafts[product.id];
    const price = Number(draft.price);
    const stock = Number(draft.stock);
    if (!draft.price.trim() || !Number.isFinite(price) || price <= 0) return setMessages((current) => ({ ...current, [product.id]: { tone: "error", text: "Fiyat sıfırdan büyük geçerli bir sayı olmalıdır." } }));
    if (!draft.stock.trim() || !Number.isFinite(stock) || !Number.isInteger(stock) || stock < 0) return setMessages((current) => ({ ...current, [product.id]: { tone: "error", text: "Stok sıfır veya daha büyük bir tam sayı olmalıdır." } }));

    setSaving(product.id);
    setMessages((current) => { const next = { ...current }; delete next[product.id]; return next; });
    try {
      const response = await fetch(`/api/seller/products/${product.id}/inventory`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ price, stock }) });
      const result = await response.json().catch(() => ({})) as { error?: string; price?: number; stock?: number };
      if (!response.ok || typeof result.price !== "number" || typeof result.stock !== "number") throw new Error(result.error ?? "Stok ve fiyat güncellenemedi.");
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, price: result.price!, stock: result.stock! } : item));
      setDrafts((current) => ({ ...current, [product.id]: { price: String(result.price), stock: String(result.stock) } }));
      setMessages((current) => ({ ...current, [product.id]: { tone: "success", text: "Kaydedildi." } }));
    } catch (error) {
      setMessages((current) => ({ ...current, [product.id]: { tone: "error", text: error instanceof Error ? error.message : "Stok ve fiyat güncellenemedi." } }));
    } finally {
      setSaving(null);
    }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ürün adı veya SKU ara" className="min-w-64 flex-1 rounded-xl border px-4 py-3 text-sm outline-none focus:border-sky-500" /><Link href="/satici-panel/urunler" className="rounded-xl border px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Ürünlere Dön</Link></div>
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-4">Ürün</th><th className="px-5 py-4">SKU</th><th className="px-5 py-4">Fiyat (₺)</th><th className="px-5 py-4">Stok</th><th className="px-5 py-4">Durum</th><th className="px-5 py-4 text-right">İşlem</th></tr></thead><tbody>{filtered.map((product) => {
      const message = messages[product.id];
      return <tr key={product.id} className="border-t"><td className="px-5 py-4 font-bold">{product.name}{message && <p role="status" className={`mt-1 text-xs ${message.tone === "error" ? "text-red-600" : "text-green-600"}`}>{message.text}</p>}</td><td className="px-5 py-4 font-mono text-xs text-slate-600">{product.sku ?? "—"}</td><td className="px-5 py-4"><input aria-label={`${product.name} fiyatı`} type="number" min="0.01" step="0.01" value={drafts[product.id].price} onChange={(event) => updateDraft(product.id, "price", event.target.value)} className="w-36 rounded-lg border px-3 py-2 outline-none focus:border-sky-500" /></td><td className="px-5 py-4"><input aria-label={`${product.name} stoğu`} type="number" min="0" step="1" value={drafts[product.id].stock} onChange={(event) => updateDraft(product.id, "stock", event.target.value)} className="w-28 rounded-lg border px-3 py-2 outline-none focus:border-sky-500" /></td><td className="px-5 py-4"><span className={product.active ? "rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700" : "rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600"}>{product.active ? "Aktif" : "Pasif"}</span></td><td className="px-5 py-4 text-right"><button disabled={saving === product.id} onClick={() => save(product)} className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving === product.id ? "Kaydediliyor..." : "Kaydet"}</button></td></tr>;
    })}</tbody></table></div>{!filtered.length && <p className="px-6 py-14 text-center text-sm text-slate-500">Eşleşen ürün bulunamadı.</p>}</div>
  </div>;
}
