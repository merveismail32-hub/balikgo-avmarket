import { notFound } from "next/navigation";
import { AdminShell } from "@/app/components/admin-shell";
import { requireAdmin } from "@/app/lib/admin-auth";
import { prisma } from "@/app/lib/prisma";
import { formatPrice } from "@/app/lib/products";
import { SHIPMENT_STATUS_LABELS } from "@/app/lib/shipping";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      orderNumber: true, createdAt: true, totalAmount: true, subtotalAmount: true, discountAmount: true,
      status: true, couponCode: true, user: { select: { name: true, surname: true } }, payment: { select: { status: true } },
      shipments: { orderBy: { createdAt: "asc" }, select: { id: true, status: true, carrierName: true, trackingNumber: true, shippedAt: true, deliveredAt: true, seller: { select: { storeName: true } }, items: { select: { quantity: true, orderItem: { select: { productName: true, productSku: true } } } } } },
      items: { select: { id: true, productName: true, productSku: true, quantity: true, unitPrice: true, status: true, shippingCompany: true, trackingNumber: true, seller: { select: { storeName: true } }, statusHistory: { select: { fromStatus: true, toStatus: true, createdAt: true }, orderBy: { createdAt: "asc" } }, refunds: { select: { status: true, amount: true } }, payout: { select: { status: true, grossAmount: true, commissionAmount: true, netAmount: true } } } },
    },
  });
  if (!order) notFound();
  const date = (value: Date | null) => value ? value.toLocaleString("tr-TR") : "—";
  return <AdminShell title={`Sipariş ${order.orderNumber}`}>
    <div className="grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-3"><p><b>Müşteri</b><br />{order.user.name} {order.user.surname}</p><p><b>Tarih</b><br />{order.createdAt.toLocaleString("tr-TR")}</p><p><b>Durum / Ödeme</b><br />{order.status} · {order.payment?.status ?? "YOK"}</p><p><b>Ara toplam</b><br />{formatPrice(Number(order.subtotalAmount ?? order.totalAmount))}</p><p><b>İndirim</b><br />{formatPrice(Number(order.discountAmount))} {order.couponCode && `(${order.couponCode})`}</p><p><b>Genel toplam</b><br />{formatPrice(Number(order.totalAmount))}</p></div>
    <section className="mt-5 rounded-2xl border bg-white p-5"><h2 className="text-lg font-black">Gönderi paketleri</h2>{order.shipments.length ? <div className="mt-4 grid gap-4 lg:grid-cols-2">{order.shipments.map((shipment, index) => <article key={shipment.id} className="rounded-xl border bg-slate-50 p-4"><div className="flex flex-wrap justify-between gap-2"><b>Paket {index + 1} · {shipment.id.slice(-8).toUpperCase()}</b><span className="text-sm font-bold text-sky-700">{SHIPMENT_STATUS_LABELS[shipment.status]}</span></div><p className="mt-2 text-sm"><b>Satıcı:</b> {shipment.seller.storeName}</p><p className="mt-1 break-all text-sm"><b>Kargo:</b> {shipment.carrierName ?? "—"} · <b>Takip:</b> {shipment.trackingNumber ?? "—"}</p><p className="mt-1 text-xs text-slate-500">Kargoya verildi: {date(shipment.shippedAt)}<br />Teslim edildi: {date(shipment.deliveredAt)}</p><ul className="mt-3 space-y-1 border-t pt-3 text-sm">{shipment.items.map((item) => <li key={item.orderItem.productName + item.orderItem.productSku}>{item.orderItem.productName} · {item.quantity} adet {item.orderItem.productSku && `· ${item.orderItem.productSku}`}</li>)}</ul></article>)}</div> : <p className="mt-3 text-sm text-slate-500">Henüz yeni paket kaydı oluşturulmamış; aşağıdaki legacy kargo bilgileri geçerlidir.</p>}</section>
    <div className="mt-5 space-y-4">{order.items.map((item) => <article key={item.id} className="rounded-2xl border bg-white p-5"><h2 className="font-black">{item.seller.storeName}</h2><p className="mt-2">{item.productName} {item.productSku && `· ${item.productSku}`} · {item.quantity} adet · {formatPrice(Number(item.unitPrice))}</p><p className="mt-2 text-sm">Durum: {item.status} · Legacy kargo: {item.shippingCompany ?? "—"} · Takip: {item.trackingNumber ?? "—"}</p>{item.refunds.map((refund, index) => <p key={index} className="mt-2 text-sm">İade: {refund.status} · {formatPrice(Number(refund.amount))}</p>)}{item.payout && <p className="mt-2 text-sm">Hakediş: {item.payout.status} · Brüt {formatPrice(Number(item.payout.grossAmount))} · Komisyon {formatPrice(Number(item.payout.commissionAmount))} · Net {formatPrice(Number(item.payout.netAmount))}</p>}<ol className="mt-3 text-xs text-slate-500">{item.statusHistory.map((history, index) => <li key={index}>{history.createdAt.toLocaleString("tr-TR")}: {history.fromStatus} → {history.toStatus}</li>)}</ol></article>)}</div>
  </AdminShell>;
}
