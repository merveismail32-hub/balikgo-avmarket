import Link from "next/link";
import type { ReactNode } from "react";

const menuItems = [
  { href: "/satici-panel", label: "Genel Bakış", icon: "▦" },
  { href: "/satici-panel/urunler", label: "Ürünlerim", icon: "◫" },
  { href: "/satici-panel/urun-ekle", label: "Ürün Ekle", icon: "+" },
  { href: "/satici-panel/siparisler", label: "Siparişler", icon: "□" },
  { href: "/satici-panel/satislar", label: "Satışlar", icon: "↗" },
  { href: "#", label: "Kampanyalar", icon: "✦" },
  { href: "#", label: "Mağaza Bilgileri", icon: "◉" },
  { href: "/satici-panel/odemeler", label: "Ödemeler", icon: "₺" },
];

export function SellerPanelShell({ title, description, children, storeName }: { title: string; description: string; children: ReactNode; storeName?: string }) {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white px-5 py-4">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4"><Link href="/" className="min-w-fit"><div className="text-2xl font-black text-sky-600">BALIK<span className="text-slate-950">GO</span></div><div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">Satıcı Merkezi</div></Link><div className="flex items-center gap-3"><span className="hidden text-sm font-semibold text-slate-500 sm:block">{storeName ?? "Mağazanız"}</span><div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 font-black text-sky-700">{(storeName ?? "M").slice(0, 2).toUpperCase()}</div></div></div>
      </header>
      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[250px_1fr]">
        <aside className="border-b bg-slate-950 p-4 text-white lg:min-h-[calc(100vh-73px)] lg:border-b-0 lg:border-r">
          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">{menuItems.map((item) => <Link key={item.label} href={item.href} className="flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-sm">{item.icon}</span>{item.label}</Link>)}</nav>
          <Link href="/" className="mt-5 hidden rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/10 lg:block">← Mağazaya Dön</Link>
        </aside>
        <section className="min-w-0 p-5 sm:p-8"><div className="mb-8"><p className="text-sm font-bold uppercase tracking-wider text-sky-600">SATICI PANELİ</p><h1 className="mt-1 text-3xl font-black sm:text-4xl">{title}</h1><p className="mt-2 text-slate-500">{description}</p></div>{children}</section>
      </div>
    </main>
  );
}
