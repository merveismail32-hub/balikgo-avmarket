import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/app/lib/prisma";

const registrationSchema = z.object({
  name: z.string().trim().min(2, "Ad en az 2 karakter olmalı.").max(80),
  surname: z.string().trim().min(2, "Soyad en az 2 karakter olmalı.").max(80),
  email: z.string().trim().email("Geçerli bir e-posta girin."),
  phone: z.string().trim().min(10, "Geçerli bir telefon numarası girin.").max(30),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı.").max(128),
  acceptedTerms: z.literal(true, { error: "Üyelik sözleşmesini onaylamalısınız." }),
});

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Geçersiz form bilgisi." }, { status: 400 });

  const email = parsed.data.email.toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) return NextResponse.json({ error: "Bu e-posta ile kayıtlı bir hesap zaten var." }, { status: 409 });

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.create({ data: { name: parsed.data.name, surname: parsed.data.surname, email, phone: parsed.data.phone, passwordHash } });
  return NextResponse.json({ ok: true }, { status: 201 });
}
