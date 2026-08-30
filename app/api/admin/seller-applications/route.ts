import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { isAdmin } from "@/app/lib/admin-auth";

export async function GET(request: NextRequest) {
  if (!await isAdmin()) return NextResponse.json({ error: "Yönetici yetkisi gerekli." }, { status: 403 });
  const status = request.nextUrl.searchParams.get("status");
  const onboardingStatuses = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEEDS_REVISION", "APPROVED", "REJECTED"] as const;
  const profiles = await prisma.sellerProfile.findMany({
    where: onboardingStatuses.includes(status as typeof onboardingStatuses[number]) ? { onboardingStatus: status as typeof onboardingStatuses[number] } : undefined,
    include: { user: { select: { name: true, surname: true, email: true, phone: true } }, kybDocuments: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(profiles);
}
