import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/app/components/product-card";
import { ProductGallery } from "@/app/components/product-gallery";
import { ProductPurchaseActions } from "@/app/components/product-purchase-actions";
import { ProductReviews } from "@/app/components/product-reviews";
import { StorefrontFooter } from "@/app/components/storefront-footer";
import { StorefrontHeader } from "@/app/components/storefront-header";
import { findPublicCatalogBySlug, listPublicCatalog, toStoreCatalogProductWithPerformance } from "@/app/lib/catalog-data";
import { toStoreProduct } from "@/app/lib/product-data";

async function getProduct(slug: string) {
  const catalog = await findPublicCatalogBySlug(slug);
  if (!catalog) return null;
  const resolved = await toStoreCatalogProductWithPerformance(catalog);
  const offer = catalog.offers.find((entry) => entry.id === resolved?.sellerOfferId && entry.legacyProduct);
  return offer?.legacyProduct ? { ...catalog, id: offer.legacyProduct.id, sku: offer.sellerSku, price: offer.price, stock: offer.stock, seller: offer.seller } : null;
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const product = await getProduct((await params).slug); return product ? { title: product.name, description: product.description.slice(0, 160), alternates: { canonical: `/urun/${product.slug}` } } : { title: "Ürün bulunamadı", robots: { index: false } }; }

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const row = await getProduct((await params).slug); if (!row) notFound();
  const catalogRow = await findPublicCatalogBySlug(row.slug); if (!catalogRow) notFound();
  const product = await toStoreCatalogProductWithPerformance(catalogRow); if (!product) notFound();
  const related = (await listPublicCatalog({ ...(row.categoryId ? { categoryId: row.categoryId } : {}), sort: "rating_desc", take: 5 })).products.filter((item) => item.catalogProductId !== catalogRow.id).slice(0, 4);
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const productJson = { "@context": "https://schema.org", "@type": "Product", name: row.name, image: product.images, description: row.description, sku: row.sku ?? undefined, offers: { "@type": "Offer", price: product.unitPrice, priceCurrency: "TRY", availability: (product.stock ?? 0) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url: `${base}/urun/${row.slug}` }, ...(row.reviewCount > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: row.rating, reviewCount: row.reviewCount } } : {}) };
  const categoryName = row.categoryRecord?.name ?? row.category;
  const categoryUrl = row.categoryRecord ? `${base}/kategori/${row.categoryRecord.slug}` : undefined;
  const breadcrumbJson = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Ana Sayfa", item: base }, { "@type": "ListItem", position: 2, name: categoryName, ...(categoryUrl ? { item: categoryUrl } : {}) }, { "@type": "ListItem", position: 3, name: row.name, item: `${base}/urun/${row.slug}` }] };
  return <main className="min-h-screen bg-slate-50"><StorefrontHeader /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJson).replace(/</g, "\\u003c") }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJson).replace(/</g, "\\u003c") }} /><nav aria-label="İçerik yolu" className="mx-auto max-w-7xl px-5 pt-6 text-sm"><Link href="/">Ana Sayfa</Link> / {row.categoryRecord ? <Link href={`/kategori/${row.categoryRecord.slug}`}>{row.categoryRecord.name}</Link> : row.category} / {row.name}</nav><section className="mx-auto grid max-w-7xl gap-10 px-5 py-8 lg:grid-cols-2"><ProductGallery name={row.name} image={row.imageUrl} images={product.images ?? []} /><div><p className="font-bold text-sky-700">{row.brandRecord?.name ?? row.brand}</p><h1 className="mt-2 text-4xl font-black">{row.name}</h1><p className="mt-3 text-slate-500">{row.reviewCount > 0 ? `★ ${row.rating.toFixed(1)} · ${row.reviewCount} değerlendirme` : "Henüz değerlendirme yok"}</p><p className="mt-6 text-4xl font-black">{product.price}</p><p className="mt-5 leading-7 text-slate-600">{row.description}</p><div className="mt-6 rounded-2xl border bg-white p-5"><p className="text-xs">SATICI</p><Link href={`/magaza/${row.seller.storeSlug}`} className="font-black text-sky-700">{row.seller.storeName}</Link></div><ProductPurchaseActions product={product} /></div></section><ProductReviews productId={row.id} rating={row.rating} reviewCount={row.reviewCount} />{related.length > 0 && <section className="mx-auto max-w-7xl px-5 py-12"><h2 className="text-2xl font-black">Benzer ürünler</h2><div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{related.map((item) => <ProductCard key={item.id} product={toStoreProduct(item)} />)}</div></section>}<StorefrontFooter /></main>;
}
