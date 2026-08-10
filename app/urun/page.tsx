"use client";

import Image from "next/image";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CartButton } from "../components/cart-button";
import { AccountLink } from "../components/account-link";
import { useCart } from "../components/cart-context";
import { FavoriteAccessButton, FavoriteButton } from "../components/favorite-button";
import { getProductById, spinOltaSeti, type Product } from "../lib/products";
import { SearchBox } from "../components/search-box";

const fallbackGalleryImages = [
  {
    label: "tam görünüm",
    imageClass: "scale-100 object-center",
  },
  {
    label: "yakın görünüm",
    imageClass: "scale-[1.35] object-left",
  },
  {
    label: "detay görünümü",
    imageClass: "scale-[1.35] object-right",
  },
  {
    label: "aksesuar görünümü",
    imageClass: "scale-[1.45] object-bottom-left",
  },
];

function ProductDetails() {
  const searchParams = useSearchParams();
  const productId = searchParams.get("urun") ?? spinOltaSeti.id;
  const fallbackProduct = getProductById(productId) ?? spinOltaSeti;
  const [selectedProduct, setSelectedProduct] = useState<Product>(fallbackProduct);
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [isAdded, setIsAdded] = useState(false);
  const { addItem } = useCart();
  const productImages = selectedProduct.images?.filter(Boolean) ?? [];
  const galleryImages = productImages.length
    ? productImages.map((src, index) => ({ src, label: index === 0 ? "ana görünüm" : `${index + 1}. ürün görünümü`, imageClass: "scale-100 object-center" }))
    : fallbackGalleryImages.map((item) => ({ ...item, src: selectedProduct.image }));
  const activeImage = galleryImages[Math.min(selectedImage, galleryImages.length - 1)];
  const oldUnitPrice = selectedProduct.oldPrice ? Number(selectedProduct.oldPrice.replace(/[^0-9,]/g, "").replace(",", ".")) : 0;
  const hasDiscount = oldUnitPrice > selectedProduct.unitPrice;
  const discountPercent = hasDiscount ? Math.round(((oldUnitPrice - selectedProduct.unitPrice) / oldUnitPrice) * 100) : 0;

  useEffect(() => {
    let active = true;
    setSelectedProduct(fallbackProduct);
    fetch(`/api/products/${encodeURIComponent(productId)}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((product: Product) => { if (active) setSelectedProduct(product); })
      .catch(() => undefined);

    return () => { active = false; };
  }, [fallbackProduct, productId]);

  useEffect(() => {
    setSelectedImage(0);
    setQuantity(1);
    setIsAdded(false);
  }, [selectedProduct.id]);

  function handleAddToCart() {
    addItem(selectedProduct, quantity);
    setIsAdded(true);
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* ÜST BAR */}
      <div className="bg-slate-950 px-5 py-2 text-center text-sm font-medium text-white">
        🎣 BalıkGo AvMarket'e hoş geldin! | Türkiye'nin balıkçılık pazaryeri
      </div>

      {/* HEADER */}
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-5">
          <a href="/" className="min-w-fit">
            <div className="text-2xl font-black text-sky-600">
              BALIK<span className="text-slate-950">GO</span>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
              AvMarket
            </div>
          </a>

          <div className="hidden flex-1 md:block">
            <SearchBox />
          </div>

          <a
            href="/"
            className="rounded-xl px-4 py-3 text-sm font-bold hover:bg-slate-100"
          >
            🏠 Ana Sayfa
          </a>

          <AccountLink className="rounded-xl px-3 py-3 text-sm font-semibold transition hover:bg-slate-100" />
          <FavoriteAccessButton className="rounded-xl px-3 py-3 text-lg transition hover:bg-red-50 hover:text-red-500 sm:gap-2 sm:px-4 sm:text-sm" />
          <CartButton className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-sky-600" />
        </div>
        <div className="border-t px-5 py-3 md:hidden"><SearchBox /></div>
      </header>

      {/* ÜRÜN */}
      <section className="mx-auto max-w-7xl px-5 py-10">
        {/* EKMEK KIRINTISI */}
        <div className="mb-8 text-sm text-slate-500">
          Ana Sayfa <span className="mx-2">›</span> {selectedProduct.category}
          <span className="mx-2">›</span>
          <span className="font-semibold text-slate-900">
            {selectedProduct.name}
          </span>
        </div>

        <div className="grid gap-10 lg:grid-cols-2">
          {/* ÜRÜN GÖRSELİ */}
          <div>
            <div className="relative aspect-square overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <span className="absolute left-5 top-5 rounded-lg bg-red-500 px-4 py-2 text-sm font-bold text-white">
                {selectedProduct.badge}
              </span>

              <FavoriteButton
                product={selectedProduct}
                className="absolute right-5 top-5 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white text-2xl shadow-md transition hover:text-red-500"
              />

              <Image
                key={selectedImage}
                src={activeImage.src}
                alt={`${selectedProduct.name} ${activeImage.label}`}
                fill
                preload
                sizes="(max-width: 1023px) calc(100vw - 2.5rem), 50vw"
                className={`object-contain p-4 transition-transform duration-500 ease-out ${activeImage.imageClass}`}
              />
            </div>

            {/* KÜÇÜK GÖRSELLER */}
            <div className="mt-4 grid grid-cols-4 gap-3">
              {galleryImages.map((image, index) => (
                <button
                  key={image.label}
                  type="button"
                  aria-label={`${selectedProduct.name} ${image.label} görselini göster`}
                  aria-pressed={selectedImage === index}
                  onClick={() => setSelectedImage(index)}
                  className={`relative aspect-square overflow-hidden rounded-xl border-2 bg-white transition focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 ${
                    selectedImage === index
                      ? "border-sky-500 shadow-md"
                      : "border-transparent hover:border-sky-300"
                  }`}
                >
                  <Image
                    src={image.src}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 22vw, 120px"
                    className={`object-cover transition duration-300 hover:scale-105 ${image.imageClass}`}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* ÜRÜN BİLGİLERİ */}
          <div>
            <p className="text-sm font-semibold text-slate-400">
              {selectedProduct.sellerName ?? "BalıkGo Mağazası"}
            </p>

            <h1 className="mt-2 text-4xl font-black leading-tight">
              {selectedProduct.name}
            </h1>

            {/* PUAN */}
            {selectedProduct.reviewCount > 0 && selectedProduct.rating > 0 ? <div className="mt-4 flex items-center gap-3"><div className="text-lg tracking-wide text-yellow-500">★★★★★</div><span className="font-semibold text-slate-700">{selectedProduct.rating.toFixed(1)}</span><span className="text-sm text-slate-400">({selectedProduct.reviewCount} değerlendirme)</span></div> : <p className="mt-4 text-sm font-semibold text-slate-400">Henüz değerlendirme yok</p>}

            <div className="my-7 border-t" />

            {/* FİYAT */}
            <div>
              <div className="flex items-end gap-3">
                <span className="text-4xl font-black text-slate-950">
                  {selectedProduct.price}
                </span>

                {hasDiscount && <span className="pb-1 text-lg text-slate-400 line-through">{selectedProduct.oldPrice}</span>}
              </div>

              {hasDiscount && <p className="mt-2 font-semibold text-green-600">%{discountPercent} indirim</p>}
            </div>

            {/* KARGO */}
            <div className="mt-6 rounded-2xl bg-green-50 p-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚚</span>

                <div>
                  <p className="font-bold text-green-800">
                    Hızlı kargo
                  </p>

                  <p className="text-sm text-green-700">
                    {selectedProduct.shippingInfo || "Tahmini teslimat: 1-3 iş günü"}
                  </p>
                </div>
              </div>
            </div>

            {/* STOK */}
            <div className={`mt-5 flex items-center gap-2 text-sm font-bold ${(selectedProduct.stock ?? 1) > 0 ? "text-green-600" : "text-red-600"}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${(selectedProduct.stock ?? 1) > 0 ? "bg-green-500" : "bg-red-500"}`} />
              {(selectedProduct.stock ?? 1) > 0 ? "Stokta" : "Stokta yok"}
            </div>

            {/* ADET */}
            <div className="mt-6">
              <p className="mb-2 text-sm font-bold">Adet</p>

              <div className="flex h-12 w-32 items-center justify-between rounded-xl border bg-white px-4">
                <button
                  type="button"
                  aria-label="Adedi azalt"
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  className="text-xl transition hover:text-sky-600 disabled:cursor-not-allowed disabled:text-slate-300"
                  disabled={quantity === 1}
                >
                  −
                </button>
                <span className="font-bold" aria-live="polite">{quantity}</span>
                <button
                  type="button"
                  aria-label="Adedi artır"
                  onClick={() => setQuantity((current) => current + 1)}
                  className="text-xl transition hover:text-sky-600"
                >
                  +
                </button>
              </div>
            </div>

            {/* SEPET */}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={(selectedProduct.stock ?? 1) < 1}
                className="flex-1 rounded-xl bg-sky-500 py-4 font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-600"
              >
                {(selectedProduct.stock ?? 1) < 1 ? "Stokta yok" : isAdded ? "✓ Sepete Eklendi" : "🛒 Sepete Ekle"}
              </button>

              <FavoriteButton
                product={selectedProduct}
                className="rounded-xl border-2 border-slate-200 px-5 text-2xl transition hover:border-red-300 hover:text-red-500"
              />
            </div>

            {/* SATICI */}
            <div className="mt-6 rounded-2xl border bg-white p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">
                    SATICI
                  </p>

                  <p className="mt-1 font-bold">
                    {selectedProduct.storeSlug ? <a href={`/magaza/${selectedProduct.storeSlug}`} className="hover:text-sky-600">{selectedProduct.sellerName}</a> : (selectedProduct.sellerName ?? "BalıkGo Mağazası")}
                  </p>
                </div>

                <div className="text-right">
                  <p className="font-bold text-yellow-500">
                    ★ 4.9
                  </p>

                  <p className="text-xs text-slate-400">
                    98% olumlu değerlendirme
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ÜRÜN DETAYLARI */}
      <section className="border-t bg-white">
        <div className="mx-auto max-w-7xl px-5 py-14">
          <div className="grid gap-12 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <p className="font-bold text-sky-600">
                ÜRÜN AÇIKLAMASI
              </p>

              <h2 className="mt-2 text-3xl font-black">
                {selectedProduct.name}
              </h2>

              <p className="mt-5 leading-8 text-slate-600">
                {selectedProduct.shortDescription}
              </p>

              <p className="mt-4 leading-8 text-slate-600">
                BalıkGo Mağazası&apos;nın seçili ürünleri, güvenli alışveriş ve hızlı kargo avantajıyla gönderilir.
              </p>
            </div>

            {/* ÖZELLİKLER */}
            <div className="rounded-2xl bg-slate-50 p-6">
              <h3 className="text-xl font-black">
                Teknik Özellikler
              </h3>

              <div className="mt-5 space-y-4 text-sm">
                {[
                  ["Kategori", selectedProduct.category],
                  ["Marka", selectedProduct.brand],
                  ["Satıcı", selectedProduct.sellerName ?? "BalıkGo Mağazası"],
                  ["Stok durumu", (selectedProduct.stock ?? 1) > 0 ? "Stokta" : "Stokta yok"],
                  ...(selectedProduct.technicalDetails ? [["Teknik bilgi", selectedProduct.technicalDetails]] : []),
                  ["Garanti", "2 yıl"],
                ].map(([label, value], index) => (
                  <div key={label} className={`flex justify-between ${index < 4 ? "border-b pb-3" : ""}`}>
                    <span className="text-slate-500">{label}</span>
                    <span className="font-bold">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GÜVEN */}
      <section className="bg-slate-950 px-5 py-12 text-white">
        <div className="mx-auto grid max-w-7xl gap-6 sm:grid-cols-3">
          <div className="rounded-2xl bg-white/5 p-6">
            <div className="text-3xl">🛡️</div>
            <h3 className="mt-3 font-bold">
              Güvenli alışveriş
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              BalıkGo güvencesiyle alışveriş yap.
            </p>
          </div>

          <div className="rounded-2xl bg-white/5 p-6">
            <div className="text-3xl">🚚</div>
            <h3 className="mt-3 font-bold">
              Hızlı teslimat
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Satıcılarımızdan hızlı gönderim.
            </p>
          </div>

          <div className="rounded-2xl bg-white/5 p-6">
            <div className="text-3xl">⭐</div>
            <h3 className="mt-3 font-bold">
              Güvenilir satıcı
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Puanlı mağazalardan alışveriş.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function ProductPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50" />}>
      <ProductDetails />
    </Suspense>
  );
}
