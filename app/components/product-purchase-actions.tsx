"use client";

import { useState } from "react";
import { useCart } from "./cart-context";
import { FavoriteButton } from "./favorite-button";
import type { Product } from "@/app/lib/products";

export function ProductPurchaseActions({ product }: { product: Product }) {
  const { addItem } = useCart(); const [quantity, setQuantity] = useState(1); const [added, setAdded] = useState(false); const stock = product.stock ?? 0;
  return <div className="mt-6">{(product.offerCount ?? 0) > 1 && <p className="mb-4 rounded-xl bg-sky-50 p-3 text-sm font-semibold text-sky-800">Bu katalog ürününde {product.offerCount} satıcı teklifi var. Şimdilik stoktaki en düşük fiyatlı teklif gösteriliyor.</p>}<div className="flex items-center gap-3"><label htmlFor="quantity" className="font-bold">Adet</label><input id="quantity" type="number" min="1" max={stock} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(stock, Number(event.target.value) || 1)))} className="w-20 rounded-xl border p-3"/></div><div className="mt-4 flex gap-3"><button disabled={!stock} onClick={() => { addItem(product, quantity); setAdded(true); }} className="flex-1 rounded-xl bg-sky-600 py-4 font-black text-white disabled:bg-slate-300">{!stock ? "Stokta yok" : added ? "Sepete eklendi" : "Sepete ekle"}</button><FavoriteButton product={product} className="rounded-xl border px-5"/></div></div>;
}
