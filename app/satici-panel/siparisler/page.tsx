import { SellerPanelShell } from "../../components/seller-panel-shell";
import { requireApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { SellerOrdersTable } from "@/app/components/seller-orders-table";
export default async function SellerOrdersPage() { const seller = await requireApprovedSeller(); const items = await prisma.orderItem.findMany({ where: { sellerId: seller.id }, include: { order: { include: { user: { select: { name: true, surname: true } } } } }, orderBy: { createdAt: "desc" } }); return <SellerPanelShell title="Siparişler" description="Yalnızca mağazanıza ait sipariş kalemlerini yönetin." storeName={seller.storeName}><SellerOrdersTable initialItems={items} /></SellerPanelShell>; }
