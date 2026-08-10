import Link from "next/link";
import { SellerPanelShell } from "../../components/seller-panel-shell";
import { SellerProductsTable } from "../../components/seller-products-table";
import { requireApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
export default async function SellerProductsPage() { const seller = await requireApprovedSeller(); const products = await prisma.product.findMany({ where: { sellerId: seller.id }, orderBy: { createdAt: "desc" } }); return <SellerPanelShell title="Ürünlerim" description="Yalnızca kendi mağazanızdaki ürünleri yönetin."><div className="mb-5 flex items-center justify-between"><p className="text-sm text-slate-500"><span className="font-black text-slate-950">{products.filter(product => product.active).length}</span> aktif ürün</p><Link href="/satici-panel/urun-ekle" className="rounded-xl bg-sky-500 px-5 py-3 text-sm font-bold text-white">+ Ürün Ekle</Link></div><SellerProductsTable initialProducts={products} /></SellerPanelShell>; }
