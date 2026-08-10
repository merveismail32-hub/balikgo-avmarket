"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CartButton } from "./cart-button";
import { AccountLink } from "./account-link";
import { useCart } from "./cart-context";
import { FavoriteAccessButton, FavoriteButton } from "./favorite-button";
import { SearchBox } from "./search-box";
import { getCategoryBySlug, type Product } from "../lib/products";

type SortOption = "recommended" | "price-asc" | "price-desc" | "rating" | "reviews";

function ProductCard({ product }: { product: Product }) {
  const { addItem } = useCart();

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-sky-300 hover:shadow-xl">
      <FavoriteButton
        product={product}
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl shadow-md transition hover:scale-110 hover:text-red-500"
      />
      <Link href={`/urun?urun=${product.id}`} className="block">
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 to-sky-50">
          <span className="absolute left-4 top-4 z-10 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white shadow">{product.badge}</span>
          <Image src={product.image} alt={product.name} fill sizes="(max-width: 640px) calc(100vw - 2.5rem), (max-width: 1023px) calc(50vw - 2rem), 33vw" className="object-contain p-5 transition duration-500 group-hover:scale-105" />
        </div>
        <div className="p-5 pb-3">
          <p className="text-xs font-semibold text-slate-400">{product.brand}</p>
          <h2 className="mt-1 min-h-12 text-base font-bold leading-6 text-slate-950 transition group-hover:text-sky-600">{product.name}</h2>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm tracking-wide text-yellow-500">★★★★★</span>
            <span className="text-xs font-semibold text-slate-700">{product.rating.toFixed(1)}</span>
            <span className="text-xs text-slate-400">({product.reviewCount})</span>
          </div>
          <div className="mt-4 flex items-end gap-2">
            <span className="text-2xl font-black text-slate-950">{product.price}</span>
            <span className="pb-1 text-sm text-slate-400 line-through">{product.oldPrice}</span>
          </div>
        </div>
      </Link>
      <div className="px-5 pb-5">
        <button type="button" onClick={() => addItem(product)} className="flex w-full items-center justify-center rounded-xl bg-slate-950 py-3.5 text-sm font-bold text-white transition hover:bg-sky-600">
          🛒 Sepete Ekle
        </button>
      </div>
    </article>
  );
}

export function CategoryListing({ slug, initialProducts }: { slug: string; initialProducts: Product[] }) {
  const category = getCategoryBySlug(slug);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState<SortOption>("recommended");

  const categoryProducts = useMemo(() => {
    const minimum = minPrice === "" ? undefined : Number(minPrice);
    const maximum = maxPrice === "" ? undefined : Number(maxPrice);
    const filtered = initialProducts.filter((product) =>
      (minimum === undefined || product.unitPrice >= minimum) &&
      (maximum === undefined || product.unitPrice <= maximum),
    );

    return [...filtered].sort((first, second) => {
      if (sort === "price-asc") return first.unitPrice - second.unitPrice;
      if (sort === "price-desc") return second.unitPrice - first.unitPrice;
      if (sort === "rating") return second.rating - first.rating;
      if (sort === "reviews") return second.reviewCount - first.reviewCount;
      return 0;
    });
  }, [initialProducts, maxPrice, minPrice, sort]);

  function clearFilters() {
    setMinPrice("");
    setMaxPrice("");
    setSort("recommended");
  }

  const hasActiveFilters = minPrice !== "" || maxPrice !== "" || sort !== "recommended";
  const categoryName = category?.name ?? "Kategori";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="bg-slate-950 px-5 py-2 text-center text-sm font-medium text-white">🎣 BalıkGo AvMarket&apos;e hoş geldin! | Türkiye&apos;nin balıkçılık pazaryeri</div>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-5 sm:gap-6">
          <Link href="/" className="min-w-fit"><div className="text-2xl font-black text-sky-600">BALIK<span className="text-slate-950">GO</span></div><div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">AvMarket</div></Link>
          <div className="hidden flex-1 md:block"><SearchBox /></div>
          <Link href="/" className="ml-auto rounded-xl px-3 py-3 text-sm font-bold transition hover:bg-slate-100 sm:px-4">🏠 <span className="hidden sm:inline">Ana Sayfa</span></Link>
          <AccountLink className="rounded-xl px-3 py-3 text-sm font-semibold transition hover:bg-slate-100" />
          <FavoriteAccessButton className="rounded-xl px-3 py-3 text-lg transition hover:bg-red-50 hover:text-red-500 sm:gap-2 sm:px-4 sm:text-sm" />
          <CartButton className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-sky-600 sm:px-5" />
        </div>
        <div className="border-t px-5 py-3 md:hidden"><SearchBox /></div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10 sm:py-14">
        <div className="mb-8">
          <p className="font-bold text-sky-600">KATEGORİ</p>
          <h1 className="mt-1 text-3xl font-black sm:text-4xl">{categoryName}</h1>
          <p className="mt-2 text-slate-500">{categoryProducts.length} ürün bulundu.</p>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[260px_1fr]">
          <aside className="rounded-2xl border bg-white p-5 shadow-sm lg:sticky lg:top-6">
            <div className="flex items-center justify-between"><h2 className="text-lg font-black">Filtrele</h2>{hasActiveFilters && <button type="button" onClick={clearFilters} className="text-xs font-bold text-sky-600 hover:text-sky-700">Filtreleri Temizle</button>}</div>
            <div className="mt-5 border-t pt-5">
              <p className="text-sm font-bold">Fiyat aralığı</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-slate-500">Minimum<input type="number" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="0 TL" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500" /></label>
                <label className="text-xs font-semibold text-slate-500">Maksimum<input type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="TL" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500" /></label>
              </div>
            </div>
          </aside>

          <div>
            <div className="mb-5 flex flex-col gap-3 rounded-2xl border bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-slate-600"><span className="font-black text-slate-950">{categoryProducts.length}</span> ürün listeleniyor</p>
              <label className="flex items-center gap-3 text-sm font-bold text-slate-700">Sırala<select value={sort} onChange={(event) => setSort(event.target.value as SortOption)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-sky-500"><option value="recommended">Önerilen</option><option value="price-asc">Fiyat: Artan</option><option value="price-desc">Fiyat: Azalan</option><option value="rating">En yüksek puan</option><option value="reviews">En çok değerlendirilen</option></select></label>
            </div>

            {categoryProducts.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{categoryProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div>
            ) : (
              <div className="rounded-3xl border bg-white px-6 py-16 text-center shadow-sm"><div className="text-4xl">🎣</div><h2 className="mt-5 text-2xl font-black">Bu kategoride henüz ürün bulunmuyor.</h2><p className="mx-auto mt-3 max-w-md text-slate-500">Yeni ürünler eklediğimizde burada görebileceksiniz.</p><div className="mt-7 flex flex-wrap justify-center gap-3"><Link href="/" className="rounded-xl bg-sky-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-sky-600">Ana Sayfaya Dön</Link><Link href="/kategori/olta-kamislari" className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-sky-500 hover:text-sky-600">Diğer Kategoriler</Link></div></div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
