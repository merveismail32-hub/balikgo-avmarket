import { SellerPanelShell } from "../../components/seller-panel-shell";
import { SellerProductForm } from "../../components/seller-product-form";
import { requireApprovedSeller } from "@/app/lib/seller-auth";
export default async function AddProductPage() { await requireApprovedSeller(); return <SellerPanelShell title="Ürün Ekle" description="Mağazanıza yeni bir ürün ekleyin."><SellerProductForm /></SellerPanelShell>; }
