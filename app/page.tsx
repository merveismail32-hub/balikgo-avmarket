import { CartButton } from "./components/cart-button";
import { AccountLink } from "./components/account-link";
import { FavoriteAccessButton, FavoriteButton } from "./components/favorite-button";
import { SearchBox } from "./components/search-box";
import Link from "next/link";
import { categories } from "./lib/products";
import { getCatalogProductsOrFallback } from "./lib/product-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const products = await getCatalogProductsOrFallback();
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* ÜST DUYURU */}
      <div className="bg-slate-950 px-4 py-2 text-center text-sm font-medium text-white">
        🎣 BalıkGo AvMarket'e hoş geldin! &nbsp; | &nbsp;
        Türkiye'nin balıkçılık pazaryeri
      </div>

      {/* HEADER */}
      <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-4">
          {/* LOGO */}
          <div className="min-w-fit">
            <div className="text-2xl font-black tracking-tight text-sky-600">
              BALIK<span className="text-slate-950">GO</span>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
              AvMarket
            </div>
          </div>

          {/* ARAMA */}
          <div className="hidden flex-1 md:block">
            <SearchBox />
          </div>

          {/* BUTONLAR */}
          <div className="flex items-center gap-3">
            <AccountLink className="rounded-xl px-3 py-3 text-sm font-semibold transition hover:bg-slate-100" />

            <FavoriteAccessButton className="rounded-xl px-3 py-3 text-lg transition hover:bg-red-50 hover:text-red-500 sm:gap-2 sm:px-4 sm:text-sm" />
            <CartButton className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-sky-600" />
          </div>
        </div>

        <div className="border-t px-5 py-3 md:hidden">
          <SearchBox />
        </div>

        {/* KATEGORİ MENÜSÜ */}
        <nav className="border-t">
          <div className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-5 py-3 text-sm font-semibold">
            <Link href="/" className="whitespace-nowrap text-sky-600">
              🏠 Ana Sayfa
            </Link>
            {categories.map((category) => (
              <Link key={category.slug} href={`/kategori/${category.slug}`} className="whitespace-nowrap transition hover:text-sky-600">
                {category.icon} {category.name}
              </Link>
            ))}
            <span className="whitespace-nowrap text-red-500">
              🔥 Kampanyalar
            </span>
          </div>
        </nav>
      </header>

      {/* HERO */}
      <section className="bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-20 md:grid-cols-2">
          <div>
            <div className="mb-5 inline-flex rounded-full border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-300">
              🎣 Balıkçıların yeni alışveriş noktası
            </div>

            <h1 className="text-4xl font-black leading-tight text-white sm:text-6xl">
              Avın için
              <br />
              <span className="text-sky-400">ne lazımsa</span>
              <br />
              burada.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              Olta, makine, misina, yem ve daha fazlası.
              Türkiye'nin balıkçılık mağazalarını tek platformda buluşturuyoruz.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <button className="rounded-xl bg-sky-500 px-7 py-4 font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400">
                Alışverişe Başla →
              </button>

              <button className="rounded-xl border border-white/20 bg-white/10 px-7 py-4 font-bold text-white backdrop-blur transition hover:bg-white/20">
                Mağazaları Keşfet
              </button>
            </div>
          </div>

          <div className="hidden md:block">
            <div className="flex aspect-square items-center justify-center rounded-[3rem] border border-white/10 bg-white/5 text-[180px] shadow-2xl backdrop-blur">
              🎣
            </div>
          </div>
        </div>
      </section>

      {/* KATEGORİLER */}
      <section className="mx-auto max-w-7xl px-5 py-14">
        <div className="mb-8">
          <p className="font-bold text-sky-600">KATEGORİLER</p>
          <h2 className="mt-1 text-3xl font-black">Aradığın her şey burada</h2>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map((category) => (
            <Link
              key={category.name}
              href={`/kategori/${category.slug}`}
              className="rounded-2xl border bg-white p-6 text-center shadow-sm transition hover:-translate-y-1 hover:border-sky-300 hover:shadow-lg"
            >
              <div className="text-4xl">{category.icon}</div>
              <div className="mt-3 text-sm font-bold">{category.name}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* ÜRÜNLER */}
<section className="bg-white py-16">
  <div className="mx-auto max-w-7xl px-5">

    {/* BAŞLIK */}
    <div className="mb-8 flex items-end justify-between">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <p className="text-sm font-bold uppercase tracking-wider text-red-500">
            Çok Satanlar
          </p>
        </div>

        <h2 className="text-3xl font-black text-slate-950">
          Balıkçıların favorileri
        </h2>

        <p className="mt-2 text-sm text-slate-500">
          En çok tercih edilen ürünleri keşfet.
        </p>
      </div>

      <button className="hidden rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-sky-500 hover:text-sky-600 sm:block">
        Tüm Ürünleri Gör →
      </button>
    </div>

    {/* ÜRÜN KARTLARI */}
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {products.map((product, index) => (
        <div
          key={product.name}
          className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white transition duration-300 hover:-translate-y-1 hover:border-sky-300 hover:shadow-xl"
        >

          {/* FAVORİ */}
          <FavoriteButton
            product={product}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl shadow-md transition hover:scale-110 hover:text-red-500"
          />

          {/* ROZET */}
          <div className="absolute left-4 top-4 z-10 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white shadow">
            {product.badge}
          </div>

          {/* ÜRÜN GÖRSEL ALANI */}
          <div className="flex h-64 items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 to-sky-50">
            <div className="flex h-44 w-44 items-center justify-center rounded-full bg-white text-8xl shadow-inner transition duration-500 group-hover:scale-110">
            <img
  src={product.image}
  alt={product.name}
  className="h-full w-full object-contain"
/>
            </div>
          </div>

          {/* ÜRÜN BİLGİLERİ */}
          <div className="p-5">

            <div className="mb-2 flex items-center gap-2">
              <div className="text-sm tracking-wide text-yellow-500">
                ★★★★★
              </div>
              <span className="text-xs text-slate-400">
                ({18 + index * 11})
              </span>
            </div>

            {product.storeSlug ? <Link href={`/magaza/${product.storeSlug}`} className="text-xs font-semibold text-slate-400 hover:text-sky-600">{product.sellerName}</Link> : <p className="text-xs font-semibold text-slate-400">{product.sellerName ?? "BalıkGo Mağazası"}</p>}

            <a
  href={`/urun?urun=${product.id}`}
  className="mt-1 block min-h-[48px] text-base font-bold leading-6 text-slate-950 hover:text-sky-600"
>
  {product.name}
</a>

            {/* FİYAT */}
            <div className="mt-4 flex items-end gap-2">
              <span className="text-2xl font-black text-slate-950">
                {product.price}
              </span>

              <span className="pb-1 text-sm text-slate-400 line-through">
                {product.oldPrice}
              </span>
            </div>

            {/* KARGO */}
            <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-green-600">
              <span>✓</span>
              <span>Hızlı kargo</span>
            </div>

            {/* SEPET */}
            <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3.5 text-sm font-bold text-white transition hover:bg-sky-600">
              🛒 Sepete Ekle
            </button>

          </div>
        </div>
      ))}
    </div>

    {/* ALT BİLGİ */}
    <div className="mt-8 flex flex-col items-center justify-between gap-4 rounded-2xl bg-slate-50 p-5 sm:flex-row">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
          🛡️
        </div>

        <div>
          <p className="text-sm font-bold text-slate-950">
            Güvenli alışveriş
          </p>

          <p className="text-xs text-slate-500">
            BalıkGo güvencesiyle alışveriş yap.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100">
          🚚
        </div>

        <div>
          <p className="text-sm font-bold text-slate-950">
            Hızlı gönderim
          </p>

          <p className="text-xs text-slate-500">
            Satıcılarımızdan hızlı teslimat.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100">
          ⭐
        </div>

        <div>
          <p className="text-sm font-bold text-slate-950">
            Güvenilir satıcılar
          </p>

          <p className="text-xs text-slate-500">
            Puanlı mağazalardan alışveriş.
          </p>
        </div>
      </div>
    </div>

  </div>
</section>

      {/* AI ASİSTAN */}
      <section className="mx-auto max-w-7xl px-5 py-16">
        <div className="overflow-hidden rounded-[2rem] bg-slate-950 p-8 text-white md:p-12">
          <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
            <div>
              <div className="mb-4 text-4xl">🤖🎣</div>

              <p className="font-bold text-sky-400">BALIKGO AI ASİSTAN</p>

              <h2 className="mt-2 text-3xl font-black sm:text-4xl">
                Ne avlayacağını söyle,
                <br />
                takımını birlikte oluşturalım.
              </h2>

              <p className="mt-4 max-w-2xl leading-7 text-slate-300">
                Balık türünü, avlanacağın bölgeyi ve bütçeni söyle.
                BalıkGo AI sana uygun ekipmanları bulsun.
              </p>
            </div>

            <button className="rounded-xl bg-sky-500 px-7 py-4 font-bold text-white transition hover:bg-sky-400">
              🤖 Asistanı Aç
            </button>
          </div>
        </div>
      </section>

      {/* SATICI ÇAĞRISI */}
      <section className="border-y bg-sky-50">
        <div className="mx-auto max-w-7xl px-5 py-14 text-center">
          <p className="font-bold text-sky-600">MAĞAZANI BÜYÜT</p>

          <h2 className="mt-2 text-3xl font-black">
            BalıkGo'da mağazanı aç.
          </h2>

          <p className="mx-auto mt-4 max-w-2xl text-slate-600">
            Balıkçılık mağazanı Türkiye'nin dört bir yanındaki müşterilerle
            buluştur. Ürünlerini yükle, satışlarını büyüt.
          </p>

          <Link href="/satici-basvuru" className="mt-7 inline-flex rounded-xl bg-slate-950 px-7 py-4 font-bold text-white transition hover:bg-sky-600">
            Satıcı Ol →
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-slate-950 px-5 py-10 text-white">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 sm:flex-row">
          <div>
            <div className="text-xl font-black">
              BALIK<span className="text-sky-400">GO</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Balıkçılığın yeni alışveriş noktası.
            </p>
          </div>

          <div className="text-sm text-slate-400">
            © 2026 BalıkGo AvMarket
          </div>
        </div>
      </footer>
    </main>
  );
}
