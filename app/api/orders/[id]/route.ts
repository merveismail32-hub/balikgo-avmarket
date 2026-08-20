import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/app/lib/prisma";
import { customerOrderSelect } from "@/app/lib/customer-order-select";
import { toCustomerOrderDto } from "@/app/lib/customer-shipment-dto";
export async function GET(_: Request, { params }: RouteContext<"/api/orders/[id]">) { const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 }); const { id } = await params; const where = session.user.role === "ADMIN" ? { id } : { id, userId: session.user.id }; const order = await prisma.order.findFirst({ where, select: customerOrderSelect }); return order ? NextResponse.json(toCustomerOrderDto(order)) : NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 }); }
