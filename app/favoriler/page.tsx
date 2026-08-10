"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { CartButton } from "../components/cart-button";
import { AccountLink } from "../components/account-link";
import { useCart } from "../components/cart-context";
import { FavoriteAccessButton } from "../components/favorite-button";
import { useFavorites } from "../components/favorite-context";
import { SearchBox } from "../components/search-box";

function FavoritesHeader() {
  return (
    <>
      <div className="bg-slate-950 px-5 py-2 text-center text-sm font-medium text-white">
        🎣 BalıkGo AvMarket&apos;e hoş geldin! | Türkiye&apos;nin balıkçılık pazaryeri
      </div>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-5 sm:gap-6">
          <Link href="/" className="min-w-fit">
            <div className="text-2xl font-black text-sky-600">
              BALIK<span className="text-slate-950">GO</span>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
              AvMarket
            </div>
          </Link>

          <div className="hidden flex-1 md:block">
            <SearchBox />
          </div>

          <Link
            href="/"
            className="ml-auto rounded-xl px-3 py-3 text-sm font-bold transition hover:bg-slate-100 sm:px-4"
          >
            🏠 <span className="hidden sm:inline">Ana Sayfa</span>
          </Link>
          <AccountLink className="rounded-xl px-3 py-3 text-sm font-semibold transition hover:bg-slate-100" />
          <FavoriteAccessButton className="rounded-xl bg-red-50 px-3 py-3 text-lg text-red-500 transition hover:bg-red-100 sm:gap-2 sm:px-4 sm:text-sm" />
          <CartButton className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-sky-600 sm:px-5" />
        </div>
        <div className="border-t px-5 py-3 md:hidden"><SearchBox /></div>
      </header>
    </>
  );
}

export default function FavoritesPage() {
  const { favorites, isLoaded, removeFavorite } = useFavorites();
  const { addItem } = useCart();
  const [addedProductId, setAddedProductId] = useState<string | null>(null);

  function handleAddToCart(product: (typeof favorites)[number]) {
    addItem(product);
    setAddedProductId(product.id);
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <FavoritesHeader />

      <section className="mx-auto max-w-7xl px-5 py-10 sm:py-14">
        {!isLoaded ? (
          <div className="rounded-3xl border bg-white px-6 py-20 text-center shadow-sm">
            <div className="text-4xl text-red-500">♥</div>
            <p className="mt-4 font-bold text-slate-600">Favorileriniz hazırlanıyor...</p>
          </div>
        ) : favorites.length === 0 ? (
          <div className="mx-auto max-w-2xl rounded-3xl border bg-white px-6 py-16 text-center shadow-sm sm:px-12">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-50 text-4xl text-red-500">
              ♡
            </div>
            <p className="mt-7 text-sm font-bold uppercase tracking-wider text-sky-600">
              BalıkGo Favorileriniz
            </p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">Favorileriniz boş</h1>
            <p className="mx-auto mt-4 max-w-md leading-7 text-slate-500">
              Beğendiğiniz ürünleri kalp ikonuna dokunarak favorilerinize ekleyebilirsiniz.
            </p>
            <Link
              href="/"
              className="mt-8 inline-flex rounded-xl bg-sky-500 px-7 py-4 font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-600"
            >
              Alışverişe Başla →
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <p className="font-bold text-sky-600">FAVORİ ÜRÜNLER</p>
              <h1 className="mt-1 text-3xl font-black sm:text-4xl">Favorileriniz</h1>
              <p className="mt-2 text-slate-500">Daha sonra incelemek için kaydettiğiniz ürünler.</p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {favorites.map((product) => (
                <article
                  key={product.id}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-sky-300 hover:shadow-xl"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-slate-50 to-sky-50">
                    <Image
                      src={product.image}
                      alt={product.name}
                      fill
                      sizes="(max-width: 640px) calc(100vw - 2.5rem), (max-width: 1023px) calc(50vw - 2rem), 33vw"
                      className="object-contain p-5 transition duration-500 group-hover:scale-105"
                    />
                    <button
                      type="button"
                      aria-label={`${product.name} ürününü favorilerden çıkar`}
                      onClick={() => removeFavorite(product.id)}
                      className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl text-red-500 shadow-md transition hover:scale-110"
                    >
                      ♥
                    </button>
                  </div>

                  <div className="p-5">
                    <p className="text-xs font-semibold text-slate-400">BalıkGo Mağazası</p>
                    <h2 className="mt-1 text-lg font-black text-slate-950">{product.name}</h2>
                    <div className="mt-4 flex items-end gap-2">
                      <span className="text-2xl font-black text-slate-950">{product.price}</span>
                      <span className="pb-1 text-sm text-slate-400 line-through">{product.oldPrice}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddToCart(product)}
                      className="mt-5 flex w-full items-center justify-center rounded-xl bg-slate-950 py-3.5 text-sm font-bold text-white transition hover:bg-sky-600"
                    >
                      {addedProductId === product.id ? "✓ Sepete Eklendi" : "🛒 Sepete Ekle"}
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-8 text-center">
              <Link
                href="/"
                className="inline-flex rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-sky-500 hover:text-sky-600"
              >
                ← Alışverişe Devam Et
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
