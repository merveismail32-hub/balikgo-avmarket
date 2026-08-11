import Link from "next/link";
import { AdminShell } from "../components/admin-shell";
import { requireAdmin } from "@/app/lib/admin-auth";
import { prisma } from "@/app/lib/prisma";

export default async function AdminPage() {
  await requireAdmin(); const today = new Date(); today.setHours(0, 0, 0, 0);
  const [pending, sellers, users, activeProducts, inactiveProducts, pendingProducts, todayOrders, paymentPending, refundPending, payoutPending, categories, brands, pendingReviews] = await Promise.all([
    prisma.sellerProfile.count({ where: { status: "PENDING" } }), prisma.sellerProfile.count({ where: { status: "APPROVED" } }), prisma.user.count(), prisma.product.count({ where: { active: true } }), prisma.product.count({ where: { active: false } }), prisma.product.count({ where: { moderationStatus: "PENDING" } }), prisma.order.count({ where: { createdAt: { gte: today } } }), prisma.payment.count({ where: { status: "PENDING" } }), prisma.refund.count({ where: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } } }), prisma.sellerPayout.count({ where: { status: { in: ["PENDING", "BLOCKED", "AVAILABLE", "SCHEDULED"] } } }), prisma.category.count(), prisma.brand.count(), prisma.review.count({ where: { status: "PENDING" } }),
  ]);
  const cards = [["Bekleyen başvurular", pending], ["Onaylı satıcılar", sellers], ["Toplam kullanıcı", users], ["Aktif ürün", activeProducts], ["Pasif ürün", inactiveProducts], ["Moderasyon bekleyen ürün", pendingProducts], ["Bugünkü sipariş", todayOrders], ["Bekleyen ödeme", paymentPending], ["Açık iade", refundPending], ["Bekleyen hakediş", payoutPending], ["Toplam kategori", categories], ["Toplam marka", brands], ["Bekleyen yorum", pendingReviews]];
  return <AdminShell title="Genel Bakış"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <div key={String(label)} className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div>)}</div><div className="mt-8 flex flex-wrap gap-3"><Link href="/admin/satici-basvurulari" className="rounded-xl bg-sky-500 px-5 py-3 font-bold text-white">Satıcı başvuruları</Link><Link href="/admin/finans" className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">Finans operasyonları</Link></div></AdminShell>;
}
