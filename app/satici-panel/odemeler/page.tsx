import Link from "next/link";
import { Prisma, type PayoutStatus } from "@prisma/client";
import { SellerPanelShell } from "@/app/components/seller-panel-shell";
import { requireApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { formatPrice } from "@/app/lib/products";
import { PAYOUT_STATUS_LABELS } from "@/app/lib/finance-labels";

const PAGE_SIZE = 20;
export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const seller = await requireApprovedSeller(); const query = await searchParams;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(query.page ?? "1", 10) || 1));
  const allowed: PayoutStatus[] = ["PENDING", "BLOCKED", "AVAILABLE", "SCHEDULED", "PAID", "CANCELLED"];
  const status = allowed.includes(query.status as PayoutStatus) ? query.status as PayoutStatus : undefined;
  const where = { sellerId: seller.id, ...(status ? { status } : {}) };
  const [total, payouts, grouped, refunds] = await Promise.all([
    prisma.sellerPayout.count({ where }),
    prisma.sellerPayout.findMany({ where, select: { id: true, grossAmount: true, commissionAmount: true, netAmount: true, status: true, createdAt: true, order: { select: { orderNumber: true } }, orderItem: { select: { productName: true, productSku: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.sellerPayout.groupBy({ by: ["status"], where: { sellerId: seller.id }, _sum: { grossAmount: true, commissionAmount: true, netAmount: true } }),
    prisma.refund.aggregate({ where: { sellerId: seller.id, status: { in: ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED"] } }, _sum: { amount: true } }),
  ]);
  const sum = (field: "grossAmount" | "commissionAmount" | "netAmount", statuses?: PayoutStatus[]) => grouped.filter((row) => !statuses || statuses.includes(row.status)).reduce((value, row) => value.add(row._sum[field] ?? 0), new Prisma.Decimal(0));
  const cards = [["Toplam satış", sum("grossAmount")], ["Platform komisyonu", sum("commissionAmount")], ["Seller hakedişi", sum("netAmount")], ["Bekleyen", sum("netAmount", ["PENDING", "BLOCKED"])], ["Uygun", sum("netAmount", ["AVAILABLE", "SCHEDULED"])], ["İptal / iade", sum("netAmount", ["CANCELLED"]).add(refunds._sum.amount ?? 0)]] as const;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <SellerPanelShell title="Finans ve hakedişler" description="Gerçek banka aktarımı yapılmaz; finans kayıtları sağlayıcı entegrasyonuna hazır olarak gösterilir." storeName={seller.storeName}><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value]) => <section key={label} className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-2xl font-black">{formatPrice(Number(value))}</p></section>)}</div><form className="mt-6 flex gap-3"><select name="status" defaultValue={status ?? ""} className="rounded-xl border bg-white p-3 text-sm"><option value="">Tüm durumlar</option>{allowed.map((value) => <option key={value} value={value}>{PAYOUT_STATUS_LABELS[value]}</option>)}</select><button className="rounded-xl bg-slate-950 px-5 text-sm font-black text-white">Filtrele</button></form><section className="mt-6 overflow-x-auto rounded-2xl border bg-white shadow-sm"><table className="min-w-[900px] w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-4">Tarih</th><th>Sipariş</th><th>Ürün / SKU</th><th>Brüt</th><th>Komisyon</th><th>Net</th><th>Durum</th></tr></thead><tbody>{payouts.length ? payouts.map((payout) => <tr key={payout.id} className="border-t"><td className="p-4">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(payout.createdAt)}</td><td>{payout.order.orderNumber}</td><td>{payout.orderItem.productName}<small className="block text-slate-500">{payout.orderItem.productSku ?? "SKU yok"}</small></td><td>{formatPrice(Number(payout.grossAmount))}</td><td>{formatPrice(Number(payout.commissionAmount))}</td><td className="font-black">{formatPrice(Number(payout.netAmount))}</td><td>{PAYOUT_STATUS_LABELS[payout.status]}</td></tr>) : <tr><td className="p-8 text-center text-slate-500" colSpan={7}>Hakediş kaydı bulunamadı.</td></tr>}</tbody></table></section>{pages > 1 && <nav className="mt-5 flex justify-center gap-3"><Link href={`?page=${Math.max(1, page - 1)}${status ? `&status=${status}` : ""}`} className="rounded-xl border bg-white px-4 py-2">Önceki</Link><span className="py-2 text-sm">{page} / {pages}</span><Link href={`?page=${Math.min(pages, page + 1)}${status ? `&status=${status}` : ""}`} className="rounded-xl border bg-white px-4 py-2">Sonraki</Link></nav>}<p className="mt-5 text-sm text-slate-500">PAID durumu gerçek payout provider entegrasyonu olmadan bu ekrandan değiştirilemez.</p></SellerPanelShell>;
}
