import { notFound } from "next/navigation";
import { SellerPanelShell } from "@/app/components/seller-panel-shell";
import { SellerProductEditForm } from "@/app/components/seller-product-edit-form";
import { requireApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";

export default async function EditSellerProductPage({ params }: PageProps<"/satici-panel/urunler/[id]/duzenle">) {
  const seller = await requireApprovedSeller(); const { id } = await params;
  const [product, categories, brands] = await Promise.all([
    prisma.product.findFirst({ where: { id, sellerId: seller.id }, include: { sellerOffer: { select: { inventoryVersion: true } } } }),
    prisma.category.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.brand.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!product) notFound();
  const images = Array.isArray(product.images) ? product.images.filter((value): value is string => typeof value === "string") : [];
  const initialImages = images.length ? images : [product.imageUrl];
  return <SellerPanelShell title="Ürünü düzenle" description="Ürün bilgilerini, stok durumunu ve görselleri güncelleyin."><SellerProductEditForm categories={categories} brands={brands} product={{ id: product.id, inventoryVersion: product.sellerOffer?.inventoryVersion ?? 0, name: product.name, sku: product.sku, moderationStatus: product.moderationStatus, moderationReason: product.moderationReason, categoryId: product.categoryId, brandId: product.brandId, category: product.category, brand: product.brand, price: Number(product.price), oldPrice: product.oldPrice ? Number(product.oldPrice) : null, stock: product.stock, description: product.description, technicalDetails: product.technicalDetails, shippingInfo: product.shippingInfo, active: product.active, images: initialImages }} /></SellerPanelShell>;
}
