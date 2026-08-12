import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/app/components/product-card";
import { StorefrontFooter } from "@/app/components/storefront-footer";
import { StorefrontHeader } from "@/app/components/storefront-header";
import { toStoreProduct } from "@/app/lib/product-data";
import { listPublicCatalog } from "@/app/lib/catalog-data";
import { prisma } from "@/app/lib/prisma";
import { publicProductPolicy } from "@/app/lib/product-visibility";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Balıkçılık Ekipmanları Pazaryeri", description: "Olta, makine, misina, yem ve balıkçılık ekipmanlarını güvenilir mağazalardan keşfedin.", alternates: { canonical: "/" } };

export default async function Home() {
  const [categories, brands, products, stores] = await Promise.all([
    prisma.category.findMany({ where: { active: true, parentId: null }, select: { name: true, slug: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 8 }),
    prisma.brand.findMany({ where: { active: true }, select: { name: true, slug: true }, orderBy: { name: "asc" }, take: 8 }),
    listPublicCatalog({ inStock: true, take: 8 }).then((result) => result.products),
    prisma.sellerProfile.findMany({ where: { status: "APPROVED", products: { some: publicProductPolicy } }, select: { storeName: true, storeSlug: true, description: true }, take: 4 }),
  ]);
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const website = { "@context": "https://schema.org", "@type": "WebSite", name: "BalıkGo AvMarket", url: base, potentialAction: { "@type": "SearchAction", target: `${base}/arama?q={search_term_string}`, "query-input": "required name=search_term_string" } };
  const organization = { "@context": "https://schema.org", "@type": "Organization", name: "BalıkGo AvMarket", url: base, logo: `${base}/favicon.ico` };

  return <main className="min-h-screen bg-slate-50"><StorefrontHeader /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }} /><section className="bg-gradient-to-br from-slate-950 to-sky-950 text-white"><div className="mx-auto max-w-7xl px-5 py-20"><p className="font-bold text-sky-300">BALIKÇILIK PAZARYERİ</p><h1 className="mt-3 max-w-3xl text-5xl font-black leading-tight">Avınız için doğru ekipmanı güvenilir mağazalardan keşfedin.</h1><p className="mt-5 max-w-2xl text-lg text-slate-300">Farklı satıcıların olta, makine, misina, yem ve aksesuarlarını tek yerde karşılaştırın.</p><div className="mt-8 flex gap-3"><Link href="/arama" className="rounded-xl bg-sky-500 px-6 py-4 font-black">Ürünleri Keşfet</Link><Link href="/markalar" className="rounded-xl border border-white/30 px-6 py-4 font-black">Markalara Göz At</Link></div></div></section>{categories.length > 0 && <section className="mx-auto max-w-7xl px-5 py-14"><h2 className="text-3xl font-black">Kategorileri keşfedin</h2><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{categories.map((item) => <Link key={item.slug} href={`/kategori/${item.slug}`} className="rounded-2xl border bg-white p-6 font-black hover:border-sky-400">{item.name}</Link>)}</div></section>}<section className="bg-white py-14"><div className="mx-auto max-w-7xl px-5"><div className="flex justify-between"><div><p className="font-bold text-sky-700">YENİ EKLENENLER</p><h2 className="text-3xl font-black">Güncel ürünler</h2></div><Link href="/arama" className="font-bold text-sky-700">Tümünü gör →</Link></div>{products.length > 0 ? <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{products.map((product) => <ProductCard key={product.id} product={toStoreProduct(product)} />)}</div> : <p className="mt-8 rounded-2xl bg-slate-50 p-8 text-slate-500">Şu anda satışta ürün bulunmuyor.</p>}</div></section>{brands.length > 0 && <section className="mx-auto max-w-7xl px-5 py-14"><h2 className="text-3xl font-black">Markalar</h2><div className="mt-6 flex flex-wrap gap-3">{brands.map((brand) => <Link key={brand.slug} href={`/marka/${brand.slug}`} className="rounded-full border bg-white px-5 py-3 font-bold">{brand.name}</Link>)}</div></section>}{stores.length > 0 && <section className="border-t bg-sky-50"><div className="mx-auto max-w-7xl px-5 py-14"><h2 className="text-3xl font-black">Mağazaları keşfedin</h2><div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">{stores.map((store) => <Link key={store.storeSlug} href={`/magaza/${store.storeSlug}`} className="rounded-2xl bg-white p-5"><h3 className="font-black">{store.storeName}</h3>{store.description && <p className="mt-2 line-clamp-2 text-sm text-slate-500">{store.description}</p>}</Link>)}</div></div></section>}<StorefrontFooter /></main>;
}
