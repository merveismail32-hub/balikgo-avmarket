import { NextResponse } from "next/server";
import { z } from "zod";
import { getApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";

const updateSchema = z.object({ stock: z.coerce.number().int().min(0).optional(), active: z.boolean().optional(), name: z.string().trim().min(2).max(160).optional(), category: z.string().trim().min(2).max(80).optional(), brand: z.string().trim().min(2).max(80).optional(), price: z.coerce.number().positive().optional(), oldPrice: z.preprocess((value) => value === "" || value === null ? null : value, z.coerce.number().positive().nullable()).optional(), description: z.string().trim().min(10).max(4000).optional(), technicalDetails: z.string().max(4000).optional(), shippingInfo: z.string().max(500).optional(), imageUrl: z.string().min(1).max(1000).optional(), images: z.array(z.string().url()).min(1).max(8).optional() });
export async function PATCH(request: Request, { params }: RouteContext<"/api/seller/products/[id]">) {
  const seller = await getApprovedSeller(); if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const { id } = await params; const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz ürün bilgisi." }, { status: 400 });
  const result = await prisma.product.updateMany({ where: { id, sellerId: seller.id }, data: parsed.data });
  return result.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
}
export async function DELETE(_: Request, { params }: RouteContext<"/api/seller/products/[id]">) {
  const seller = await getApprovedSeller(); if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const { id } = await params; const result = await prisma.product.updateMany({ where: { id, sellerId: seller.id }, data: { active: false } });
  return result.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
}
