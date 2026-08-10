import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { isAdmin } from "@/app/lib/admin-auth";

export async function GET(request: NextRequest) {
  if (!await isAdmin()) return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const status = request.nextUrl.searchParams.get("status");
  const profiles = await prisma.sellerProfile.findMany({
    where: status === "PENDING" || status === "APPROVED" || status === "REJECTED" ? { status } : undefined,
    include: { user: { select: { name: true, surname: true, email: true, phone: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(profiles);
}
