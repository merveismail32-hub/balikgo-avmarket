import { NextResponse } from "next/server";
import { getApprovedSeller } from "@/app/lib/seller-auth";
import { prisma } from "@/app/lib/prisma";
export async function GET() { const seller = await getApprovedSeller(); if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 }); return NextResponse.json(await prisma.orderItem.findMany({ where: { sellerId: seller.id }, include: { order: { include: { user: { select: { name: true, surname: true, email: true } } } } }, orderBy: { createdAt: "desc" } })); }
