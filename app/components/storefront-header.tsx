import Link from "next/link";
import { prisma } from "@/app/lib/prisma";
import { AccountLink } from "./account-link";
import { CartButton } from "./cart-button";
import { FavoriteAccessButton } from "./favorite-button";
import { SearchBox } from "./search-box";

export async function StorefrontHeader({ initialQuery = "" }: { initialQuery?: string } = {}) {
  const categories = await prisma.category.findMany({ where: { active: true, parentId: null }, select: { name: true, slug: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 10 }).catch(() => []);
  return <><div className="bg-slate-950 px-4 py-2 text-center text-xs font-medium text-white sm:text-sm">Balıkçılık ekipmanlarını güvenilir mağazalardan keşfedin.</div><header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:gap-6"><Link href="/" aria-label="BalıkGo ana sayfa" className="shrink-0 text-2xl font-black text-sky-600">BALIK<span className="text-slate-950">GO</span><span className="block text-[9px] tracking-[.25em] text-slate-500">AVMARKET</span></Link><div className="hidden flex-1 md:block"><SearchBox initialQuery={initialQuery} /></div><nav aria-label="Müşteri işlemleri" className="ml-auto flex items-center gap-1 sm:gap-2"><AccountLink className="rounded-xl px-3 py-2 text-sm font-bold hover:bg-slate-100" /><FavoriteAccessButton className="rounded-xl px-3 py-2 text-sm hover:bg-red-50" /><CartButton className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white" /></nav></div><div className="border-t px-4 py-3 md:hidden"><SearchBox initialQuery={initialQuery} /></div><nav aria-label="Ürün kategorileri" className="border-t"><div className="mx-auto flex max-w-7xl gap-5 overflow-x-auto px-4 py-3 text-sm font-bold"><Link href="/arama" className="shrink-0 text-sky-700">Tüm ürünler</Link>{categories.map((category) => <Link key={category.slug} href={`/kategori/${category.slug}`} className="shrink-0 hover:text-sky-600">{category.name}</Link>)}<Link href="/markalar" className="shrink-0 hover:text-sky-600">Markalar</Link></div></nav></header></>;
}
