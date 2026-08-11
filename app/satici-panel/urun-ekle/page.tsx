import { SellerPanelShell } from "../../components/seller-panel-shell";
import { SellerProductForm } from "../../components/seller-product-form";
import { requireApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";

export default async function AddProductPage() {
  await requireApprovedSeller();
  const [categories, brands] = await Promise.all([
    prisma.category.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.brand.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return <SellerPanelShell title="Ürün Ekle" description="Mağazanıza yeni bir ürün ekleyin."><SellerProductForm categories={categories} brands={brands} /></SellerPanelShell>;
}
