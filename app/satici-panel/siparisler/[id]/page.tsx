import { notFound } from "next/navigation";
import { SellerPanelShell } from "@/app/components/seller-panel-shell";
import { SellerOrderDetail } from "@/app/components/seller-order-detail";
import { requireApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { SellerShipmentPanel } from "@/app/components/seller-shipment-panel";

export default async function SellerOrderDetailPage({ params }: PageProps<"/satici-panel/siparisler/[id]">) {
  const seller = await requireApprovedSeller();
  const { id } = await params;
  const legacyItem = await prisma.orderItem.findFirst({ where: { id, sellerId: seller.id }, select: { orderId: true } });
  const order = await prisma.order.findFirst({
    where: { id: legacyItem?.orderId ?? id, items: { some: { sellerId: seller.id } } },
    select: {
      id: true, orderNumber: true, recipientName: true, phone: true, city: true, district: true,
      address: true, postalCode: true, createdAt: true,
      shipments: { where: { sellerId: seller.id }, orderBy: { createdAt: "asc" }, select: { id: true, status: true, carrierCode: true, carrierName: true, trackingNumber: true, items: { select: { quantity: true, orderItem: { select: { id: true, productName: true, productSku: true } } } }, events: { where: { applied: true }, orderBy: [{ eventTime: "asc" }, { receivedAt: "asc" }], select: { id: true, status: true, eventTime: true, location: true, description: true } } } },
      items: {
        where: { sellerId: seller.id }, orderBy: { createdAt: "asc" },
        select: { id: true, productName: true, productSku: true, productImageUrl: true, unitPrice: true, quantity: true, commissionAmount: true, sellerNetAmount: true, status: true, shippingCompany: true, trackingNumber: true, createdAt: true, shipmentItems: { select: { shipmentId: true } }, statusHistory: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!order) notFound();
  const view = { ...order, items: order.items.map((item) => ({ ...item, unitPrice: Number(item.unitPrice), commissionAmount: item.commissionAmount ? Number(item.commissionAmount) : null, sellerNetAmount: item.sellerNetAmount ? Number(item.sellerNetAmount) : null })) };
  const shipments = order.shipments.map((shipment) => ({ ...shipment, events: shipment.events.map((event) => ({ ...event, eventTime: event.eventTime.toISOString() })) }));
  const availableItems = order.items.filter((item) => item.shipmentItems.length === 0 && item.status !== "CANCELLED").map((item) => ({ id: item.id, productName: item.productName, productSku: item.productSku, quantity: item.quantity }));
  const shipmentRevision = `${shipments.map((shipment) => `${shipment.id}:${shipment.status}:${shipment.events.length}`).join("|")}:${availableItems.map((item) => item.id).join("|")}`;
  return <SellerPanelShell title="Sipariş detayı" description="Yalnızca mağazanıza ait ürünlerin gönderi ve durum işlemlerini yönetin." storeName={seller.storeName}><SellerShipmentPanel key={shipmentRevision} orderId={order.id} initialShipments={shipments} initialAvailableItems={availableItems} /><SellerOrderDetail key={order.items.map((item) => `${item.id}:${item.status}`).join("|")} order={view} /></SellerPanelShell>;
}
