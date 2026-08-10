import { SellerPanelShell } from "../components/seller-panel-shell";
import { requireApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";

export default async function SellerDashboard() {
  const seller = await requireApprovedSeller();
  const [total, active, outOfStock] = await Promise.all([
    prisma.product.count({ where: { sellerId: seller.id } }),
    prisma.product.count({ where: { sellerId: seller.id, active: true } }),
    prisma.product.count({ where: { sellerId: seller.id, stock: 0, active: true } }),
  ]);
  const stats = [["Toplam ürün", total, "Mağazanızdaki tüm ürünler", "bg-sky-100 text-sky-700"], ["Aktif ürün", active, "Müşterilerin gördüğü ürünler", "bg-green-100 text-green-700"], ["Stokta olmayan", outOfStock, "Stok güncellemesi gerekli", "bg-amber-100 text-amber-700"], ["Siparişler", "—", "Sipariş altyapısı yakında", "bg-violet-100 text-violet-700"]];
  return <SellerPanelShell title="Genel Bakış" description="Mağazanızın güncel ürün durumunu takip edin."><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map(([label, value, note, color]) => <div key={String(label)} className="rounded-2xl border bg-white p-5 shadow-sm"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>↗</div><p className="mt-5 text-sm font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p><p className="mt-2 text-xs font-bold text-slate-500">{note}</p></div>)}</div><div className="mt-8 rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{seller.storeName}</h2><p className="mt-2 text-sm text-slate-500">{seller.city} · {seller.categories || "Kategori bilgisi yakında eklenecek."}</p></div></SellerPanelShell>;
}
