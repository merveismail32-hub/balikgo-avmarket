import { auth } from "@/auth";
import { getSellerInstallmentReadModel, InstallmentReadModelError } from "@/app/lib/installment-read-model";
import { NextResponse } from "next/server";
import { z } from "zod";

const querySchema = z.object({ offerId: z.string().min(1).optional(), amount: z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/).optional() }).strict().superRefine((value, context) => {
  if ((value.offerId && !value.amount) || (!value.offerId && value.amount)) context.addIssue({ code: "custom", message: "Offer ve amount birlikte gerekli." });
});
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (session.user.role !== "SELLER") return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz sorgu." }, { status: 400 });
  try {
    return NextResponse.json(await getSellerInstallmentReadModel({ actorUserId: session.user.id, ...parsed.data }));
  } catch (error) {
    if (error instanceof InstallmentReadModelError) return NextResponse.json({ error: error.code === "FORBIDDEN" ? "Satıcı yetkisi gerekli." : "Read model bulunamadı." }, { status: error.code === "FORBIDDEN" ? 403 : 404 });
    throw error;
  }
}
