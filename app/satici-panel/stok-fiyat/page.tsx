import { InventoryPriceTable } from "@/app/components/inventory-price-table";
import { SellerPanelShell } from "@/app/components/seller-panel-shell";
import { prisma } from "@/app/lib/prisma";
import { requireApprovedSeller } from "@/app/lib/seller-auth";

export default async function InventoryPricePage() {
  const seller = await requireApprovedSeller();
  const products = await prisma.product.findMany({
    where: { sellerId: seller.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, sku: true, price: true, stock: true, active: true },
  });
  const rows = products.map((product) => ({ ...product, price: Number(product.price) }));

  return <SellerPanelShell title="Stok & Fiyat" description="Ürün fiyatlarını ve stoklarını hızlıca güncelleyin." storeName={seller.storeName}><InventoryPriceTable initialProducts={rows} /></SellerPanelShell>;
}
