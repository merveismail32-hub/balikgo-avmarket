import type { OrderStatus, Prisma } from "@prisma/client";
import { SellerPanelShell } from "../../components/seller-panel-shell";
import { SellerOrdersTable, type SellerOrderRow } from "@/app/components/seller-orders-table";
import { requireApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
import { SHIPPING_COMPANIES } from "@/app/lib/order-status";

const PAGE_SIZE = 20;
const statuses = ["NEW", "PREPARING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED"] as const;

export default async function SellerOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const seller = await requireApprovedSeller();
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] : "";
  const q = value("q").trim().slice(0, 120);
  const requestedStatus = value("status");
  const status = statuses.includes(requestedStatus as typeof statuses[number]) ? requestedStatus : "";
  const requestedCarrier = value("carrier");
  const carrier = SHIPPING_COMPANIES.includes(requestedCarrier as typeof SHIPPING_COMPANIES[number]) ? requestedCarrier : "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(value("from")) ? value("from") : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(value("to")) ? value("to") : "";
  const page = Math.max(1, Math.min(10_000, Number.parseInt(value("page"), 10) || 1));
  const dateFilter = from || to ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}), ...(to ? { lt: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000) } : {}) } } : {};
  const itemFilter: Prisma.OrderItemWhereInput = {
    sellerId: seller.id,
    ...(status ? status === "DELIVERED" ? { status: { in: ["DELIVERED", "COMPLETED"] } } : { status: status as OrderStatus } : {}),
    ...(carrier ? { shippingCompany: carrier } : {}),
    ...(q ? { OR: [
      { productName: { contains: q, mode: "insensitive" } }, { productSku: { contains: q, mode: "insensitive" } },
      { trackingNumber: { contains: q, mode: "insensitive" } }, { order: { orderNumber: { contains: q, mode: "insensitive" } } },
      { order: { user: { name: { contains: q, mode: "insensitive" } } } }, { order: { user: { surname: { contains: q, mode: "insensitive" } } } },
    ] } : {}),
  };
  const where: Prisma.OrderWhereInput = { ...dateFilter, items: { some: itemFilter } };
  const [total, orders, grouped] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: { id: true, orderNumber: true, createdAt: true, user: { select: { name: true, surname: true } }, items: { where: { sellerId: seller.id }, select: { id: true, productName: true, productSku: true, productImageUrl: true, unitPrice: true, quantity: true, status: true, shippingCompany: true, trackingNumber: true } } } }),
    prisma.orderItem.groupBy({ by: ["status"], where: { sellerId: seller.id }, _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(grouped.map((entry) => [entry.status, entry._count._all]));
  const rows: SellerOrderRow[] = orders.map((order) => ({ id: order.id, orderNumber: order.orderNumber, createdAt: order.createdAt, customerName: `${order.user.name} ${order.user.surname}`, items: order.items.map((item) => ({ ...item, unitPrice: Number(item.unitPrice) })) }));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <SellerPanelShell title="Siparişler" description="Mağazanıza ait siparişleri güvenli operasyon akışıyla yönetin." storeName={seller.storeName}><SellerOrdersTable orders={rows} counts={counts} filters={{ q, status, carrier, from, to }} page={Math.min(page, totalPages)} totalPages={totalPages} /></SellerPanelShell>;
}
