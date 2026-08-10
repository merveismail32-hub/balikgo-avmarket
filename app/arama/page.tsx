"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CartButton } from "../components/cart-button";
import { AccountLink } from "../components/account-link";
import { FavoriteAccessButton } from "../components/favorite-button";
import { SearchBox } from "../components/search-box";
import { searchProducts, type Product } from "../lib/products";

function SearchPageContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const [results, setResults] = useState<Product[]>(() => searchProducts(query));

  useEffect(() => {
    let active = true;
    setResults(searchProducts(query));

    if (!query.trim()) return;
    fetch(`/api/products?q=${encodeURIComponent(query)}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((products: Product[]) => { if (active) setResults(products); })
      .catch(() => undefined);

    return () => { active = false; };
  }, [query]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="bg-slate-950 px-5 py-2 text-center text-sm font-medium text-white">
        🎣 BalıkGo AvMarket&apos;e hoş geldin! | Türkiye&apos;nin balıkçılık pazaryeri
      </div>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-5 sm:gap-6">
          <Link href="/" className="min-w-fit">
            <div className="text-2xl font-black text-sky-600">
              BALIK<span className="text-slate-950">GO</span>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">AvMarket</div>
          </Link>
          <div className="hidden flex-1 md:block"><SearchBox initialQuery={query} /></div>
          <Link href="/" className="ml-auto rounded-xl px-3 py-3 text-sm font-bold transition hover:bg-slate-100 sm:px-4">
            🏠 <span className="hidden sm:inline">Ana Sayfa</span>
          </Link>
          <AccountLink className="rounded-xl px-3 py-3 text-sm font-semibold transition hover:bg-slate-100" />
          <FavoriteAccessButton className="rounded-xl px-3 py-3 text-lg transition hover:bg-red-50 hover:text-red-500 sm:gap-2 sm:px-4 sm:text-sm" />
          <CartButton className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-sky-600 sm:px-5" />
        </div>
        <div className="border-t px-5 py-3 md:hidden"><SearchBox initialQuery={query} /></div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10 sm:py-14">
        {!query.trim() ? (
          <div className="mx-auto max-w-2xl rounded-3xl border bg-white px-6 py-16 text-center shadow-sm sm:px-12">
            <div className="text-4xl">🔎</div>
            <h1 className="mt-5 text-3xl font-black">Ne aramak istersiniz?</h1>
            <p className="mt-3 text-slate-500">Ürün adı, marka veya kategori yazarak BalıkGo ürünlerini keşfedebilirsiniz.</p>
          </div>
        ) : results.length === 0 ? (
          <div className="mx-auto max-w-2xl rounded-3xl border bg-white px-6 py-16 text-center shadow-sm sm:px-12">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-sky-100 text-4xl">🔎</div>
            <p className="mt-7 text-sm font-bold uppercase tracking-wider text-sky-600">ARAMA SONUÇLARI</p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">Ürün bulunamadı</h1>
            <p className="mx-auto mt-4 max-w-md leading-7 text-slate-500">
              &quot;{query}&quot; için eşleşen ürün bulamadık. Farklı bir ürün adı, marka veya kategori deneyin.
            </p>
            <Link href="/" className="mt-8 inline-flex rounded-xl bg-sky-500 px-7 py-4 font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-600">
              Ana Sayfaya Dön →
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <p className="font-bold text-sky-600">ARAMA SONUÇLARI</p>
              <h1 className="mt-1 text-3xl font-black sm:text-4xl">&quot;{query}&quot; için sonuçlar</h1>
              <p className="mt-2 text-slate-500">{results.length} ürün bulundu.</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((product) => (
                <Link
                  key={product.id}
                  href={`/urun?urun=${product.id}`}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-sky-300 hover:shadow-xl"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-slate-50 to-sky-50">
                    <Image src={product.image} alt={product.name} fill sizes="(max-width: 640px) calc(100vw - 2.5rem), (max-width: 1023px) calc(50vw - 2rem), 33vw" className="object-contain p-5 transition duration-500 group-hover:scale-105" />
                    <span className="absolute left-4 top-4 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-bold text-sky-700 shadow-sm">{product.category}</span>
                  </div>
                  <div className="p-5">
                    <p className="text-xs font-semibold text-slate-400">{product.brand}</p>
                    <h2 className="mt-1 text-lg font-black text-slate-950 group-hover:text-sky-600">{product.name}</h2>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{product.shortDescription}</p>
                    <p className="mt-4 text-2xl font-black text-slate-950">{product.price}</p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50" />}>
      <SearchPageContent />
    </Suspense>
  );
}
