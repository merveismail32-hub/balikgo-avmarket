import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { formatPrice } from "@/app/lib/products";

export default async function StorePage({ params }: PageProps<"/magaza/[slug]">) {
  const { slug } = await params;
  const store = await prisma.sellerProfile.findUnique({ where: { storeSlug: slug }, include: { products: { where: { active: true, stock: { gt: 0 } }, orderBy: { createdAt: "desc" } } } });
  if (!store || store.status !== "APPROVED") notFound();
  return <main className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5"><Link href="/" className="text-2xl font-black text-sky-600">BALIK<span className="text-slate-950">GO</span></Link><Link href="/" className="rounded-xl px-4 py-3 text-sm font-bold hover:bg-slate-100">Ana Sayfa</Link></div></header><section className="border-b bg-slate-950 text-white"><div className="mx-auto max-w-7xl px-5 py-12"><p className="text-sm font-bold text-sky-300">BALIKGO MAĞAZASI</p><h1 className="mt-2 text-4xl font-black">{store.storeName}</h1><p className="mt-4 max-w-2xl leading-7 text-slate-300">{store.description}</p><p className="mt-4 text-sm font-semibold text-sky-200">{store.city}</p></div></section><section className="mx-auto max-w-7xl px-5 py-12"><h2 className="text-3xl font-black">Mağaza ürünleri</h2><p className="mt-2 text-slate-500">{store.products.length} aktif ürün</p><div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{store.products.map(product => <Link key={product.id} href={`/urun?urun=${product.id}`} className="overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-1 hover:border-sky-300"><div className="relative aspect-[4/3] bg-slate-50"><Image src={product.imageUrl} alt={product.name} fill className="object-contain p-5" /></div><div className="p-5"><p className="text-xs font-semibold text-slate-400">{product.brand}</p><h3 className="mt-1 font-black">{product.name}</h3><p className="mt-4 text-xl font-black">{formatPrice(Number(product.price))}</p></div></Link>)}</div></section></main>;
}
