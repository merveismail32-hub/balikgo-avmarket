"use client";

import Image from "next/image";
import Link from "next/link";
import { CartButton } from "../components/cart-button";
import { AccountLink } from "../components/account-link";
import { useCart } from "../components/cart-context";
import { FavoriteAccessButton } from "../components/favorite-button";
import { SearchBox } from "../components/search-box";
import { formatPrice } from "../lib/products";

function CartHeader() {
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
          <FavoriteAccessButton className="rounded-xl px-3 py-3 text-lg transition hover:bg-red-50 hover:text-red-500 sm:gap-2 sm:px-4 sm:text-sm" />
          <CartButton className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-sky-600 sm:px-5" />
        </div>
        <div className="border-t px-5 py-3 md:hidden"><SearchBox /></div>
      </header>
    </>
  );
}

export default function CartPage() {
  const {
    items,
    subtotal,
    isLoaded,
    increaseQuantity,
    decreaseQuantity,
    removeItem,
    clearCart,
  } = useCart();
  const hasUnavailableOffer = items.some((item) => item.offerAvailable === false);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <CartHeader />

      <section className="mx-auto max-w-7xl px-5 py-10 sm:py-14">
        {!isLoaded ? (
          <div className="rounded-3xl border bg-white px-6 py-20 text-center shadow-sm">
            <div className="text-4xl">🛒</div>
            <p className="mt-4 font-bold text-slate-600">Sepetiniz hazırlanıyor...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="mx-auto max-w-2xl rounded-3xl border bg-white px-6 py-16 text-center shadow-sm sm:px-12">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-sky-100 text-4xl">
              🛒
            </div>
            <p className="mt-7 text-sm font-bold uppercase tracking-wider text-sky-600">
              BalıkGo Sepetiniz
            </p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">Sepetiniz boş</h1>
            <p className="mx-auto mt-4 max-w-md leading-7 text-slate-500">
              Avınız için ihtiyacınız olan ekipmanları keşfedin ve sepetinize ekleyin.
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
            <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="font-bold text-sky-600">ALIŞVERİŞ SEPETİ</p>
                <h1 className="mt-1 text-3xl font-black sm:text-4xl">Sepetiniz</h1>
              </div>
              <button
                type="button"
                onClick={clearCart}
                className="w-fit rounded-xl px-4 py-3 text-sm font-bold text-red-500 transition hover:bg-red-50"
              >
                Sepeti Temizle
              </button>
            </div>

            <div className="grid items-start gap-8 lg:grid-cols-[1fr_360px]">
              <div className="space-y-4">
                {items.map((item) => (
                  <article
                    key={item.id}
                    className="flex flex-col gap-5 rounded-2xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:p-5"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-50 sm:w-32 sm:flex-none">
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        sizes="(max-width: 640px) calc(100vw - 4rem), 128px"
                        className="object-contain p-2"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-400">{item.sellerName ?? "BalıkGo Mağazası"}</p>
                      <h2 className="mt-1 text-lg font-black text-slate-950">{item.name}</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        Birim fiyat: <span className="font-bold text-slate-900">{item.price}</span>
                      </p>
                      {item.offerAvailable === false && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm font-bold text-red-700">Seçili satıcı teklifi artık uygun değil. Sepete başka bir teklifi açıkça ekleyin.</p>}

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                        <div className="flex h-11 w-32 items-center justify-between rounded-xl border bg-white px-3">
                          <button
                            type="button"
                            aria-label={`${item.name} adedini azalt`}
                            onClick={() => decreaseQuantity(item.id)}
                            disabled={item.quantity === 1}
                            className="text-xl transition hover:text-sky-600 disabled:cursor-not-allowed disabled:text-slate-300"
                          >
                            −
                          </button>
                          <span className="font-bold" aria-live="polite">{item.quantity}</span>
                          <button
                            type="button"
                            aria-label={`${item.name} adedini artır`}
                            onClick={() => increaseQuantity(item.id)}
                            disabled={item.quantity >= (item.stock ?? Number.MAX_SAFE_INTEGER)}
                            className="text-xl transition hover:text-sky-600"
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="text-sm font-bold text-red-500 transition hover:text-red-700"
                        >
                          Ürünü kaldır
                        </button>
                      </div>
                    </div>

                    <p className="text-right text-xl font-black text-slate-950 sm:self-start">
                      {formatPrice(item.unitPrice * item.quantity)}
                    </p>
                  </article>
                ))}
              </div>

              <aside className="rounded-2xl border bg-white p-6 shadow-sm lg:sticky lg:top-6">
                <h2 className="text-xl font-black">Sipariş Özeti</h2>
                <div className="mt-6 space-y-4 border-b pb-5 text-sm">
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Ara toplam</span>
                    <span className="font-bold text-slate-950">{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Kargo</span>
                    <span className="font-bold text-green-600">Ücretsiz</span>
                  </div>
                </div>
                <div className="mt-5 flex items-end justify-between">
                  <span className="text-lg font-black">Genel toplam</span>
                  <span className="text-2xl font-black text-slate-950">{formatPrice(subtotal)}</span>
                </div>
                {hasUnavailableOffer ? <span className="mt-6 block w-full cursor-not-allowed rounded-xl bg-slate-300 py-4 text-center font-bold text-slate-600">Önce uygun olmayan teklifi güncelleyin</span> : <Link href="/checkout" className="mt-6 block w-full rounded-xl bg-sky-500 py-4 text-center font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-600">Güvenli Ödemeye Geç →</Link>}
                <Link
                  href="/"
                  className="mt-3 block w-full rounded-xl border border-slate-200 py-3 text-center text-sm font-bold text-slate-700 transition hover:border-sky-500 hover:text-sky-600"
                >
                  ← Alışverişe Devam Et
                </Link>
              </aside>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
