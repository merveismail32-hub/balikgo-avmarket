import { notFound } from "next/navigation";
import { SellerPanelShell } from "@/app/components/seller-panel-shell";
import { SellerOrderDetail } from "@/app/components/seller-order-detail";
import { requireApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";

export default async function SellerOrderDetailPage({ params }: PageProps<"/satici-panel/siparisler/[id]">) {
  const seller = await requireApprovedSeller();
  const { id } = await params;
  const item = await prisma.orderItem.findFirst({
    where: { id, sellerId: seller.id },
    include: { order: { include: { user: { select: { name: true, surname: true } } } }, statusHistory: { orderBy: { createdAt: "asc" } } },
  });
  if (!item) notFound();
  return <SellerPanelShell title="Sipariş detayı" description="Gönderi ve sipariş durumunu güvenli operasyon akışıyla yönetin." storeName={seller.storeName}><SellerOrderDetail item={item} /></SellerPanelShell>;
}
