import { InventoryPriceTable } from "@/app/components/inventory-price-table";
import { SellerPanelShell } from "@/app/components/seller-panel-shell";
import { prisma } from "@/app/lib/prisma";
import { requireApprovedSeller } from "@/app/lib/seller-auth";

export default async function InventoryPricePage() {
  const seller = await requireApprovedSeller();
  const products = await prisma.product.findMany({
    where: { sellerId: seller.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, sku: true, category: true, imageUrl: true, price: true, stock: true, active: true, catalogProduct: { select: { model: true, barcode: true } } },
  });
  const rows = products.map((product) => ({ ...product, model: product.catalogProduct?.model ?? null, barcode: product.catalogProduct?.barcode ?? null, price: Number(product.price) }));

  return <SellerPanelShell title="Stok & Fiyat" description="Ürün fiyatlarını ve stoklarını hızlıca güncelleyin." storeName={seller.storeName}><InventoryPriceTable initialProducts={rows} /></SellerPanelShell>;
}
