import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { AccountHeader } from "@/app/components/account-header";
import { formatPrice } from "@/app/lib/products";
import { OrderTracking } from "@/app/components/order-tracking";
import { ORDER_STATUS_LABELS } from "@/app/lib/order-status";

function hasShippingInfo(status: string) { return status === "SHIPPED" || status === "DELIVERED" || status === "COMPLETED"; }

export default async function OrderDetailPage({ params }: PageProps<"/hesabim/siparisler/[id]">) {
  const session = await auth(); if (!session?.user?.id) redirect("/giris");
  const { id } = await params;
  const order = await prisma.order.findFirst({ where: { id, userId: session.user.id }, include: { items: { include: { seller: true } } } });
  if (!order) notFound();
  return <main className="min-h-screen bg-slate-50"><AccountHeader /><section className="mx-auto max-w-5xl px-5 py-10"><Link href="/hesabim/siparisler" className="text-sm font-bold text-sky-600">← Siparişlerim</Link><div className="mt-5 rounded-2xl border bg-white p-6 shadow-sm"><div className="flex justify-between gap-4"><div><p className="text-sm text-slate-500">Sipariş numarası</p><h1 className="text-2xl font-black">{order.orderNumber}</h1></div><b>{ORDER_STATUS_LABELS[order.status]}</b></div><OrderTracking statuses={order.items.map((item) => item.status)} /><div className="mt-6 space-y-4 border-t pt-5">{order.items.map((item) => <div key={item.id} className="flex justify-between gap-4"><span><b>{item.productName}</b><br /><small className="text-slate-500">{item.seller.storeName} · {item.quantity} adet · {ORDER_STATUS_LABELS[item.status]}</small>{hasShippingInfo(item.status) && item.shippingCompany && <small className="mt-1 block text-sky-700">Kargo: {item.shippingCompany}{item.trackingNumber ? ` · Takip no: ${item.trackingNumber}` : ""}</small>}</span><b>{formatPrice(Number(item.unitPrice) * item.quantity)}</b></div>)}</div><div className="mt-6 border-t pt-5"><b>Toplam: {formatPrice(Number(order.totalAmount))}</b><p className="mt-4 text-sm text-slate-600">Teslimat: {order.recipientName}, {order.address}, {order.district}/{order.city}</p></div></div></section></main>;
}
