import { NextResponse } from "next/server";
import { authorizeInternalJob } from "@/app/lib/internal-job-auth";
import { runPaymentExpiryBatch } from "@/app/lib/payment-expiry";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!authorizeInternalJob(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const result = await runPaymentExpiryBatch(prisma);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
