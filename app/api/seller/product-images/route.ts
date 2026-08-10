import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getApprovedSeller } from "@/app/lib/seller-auth";

const BUCKET = "product-images";
const MAX_FILES = 8;
const MAX_SIZE = 5 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
function storageConfig() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Bazı kurulumlarda URL yanlışlıkla PostgREST kökü (`/rest/v1`) ile kaydedilebilir.
  // Storage API her zaman proje kökünden çağrılmalıdır.
  return url && key ? { url: url.replace(/\/$/, "").replace(/\/rest\/v1$/, ""), key } : null;
}
async function ensureBucket(config: { url: string; key: string }) {
  const headers = { Authorization: `Bearer ${config.key}`, apikey: config.key, "Content-Type": "application/json" };
  const current = await fetch(`${config.url}/storage/v1/bucket/${BUCKET}`, { headers });
  if (current.ok) return;
  const currentBody = await current.text();
  const missingBucket = current.status === 404 || (current.status === 400 && currentBody.includes("NoSuchBucket"));
  if (!missingBucket) throw new Error(`bucket-check:${current.status}:${currentBody}`);
  const created = await fetch(`${config.url}/storage/v1/bucket`, { method: "POST", headers, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: MAX_SIZE, allowed_mime_types: [...allowedTypes] }) });
  if (!created.ok && created.status !== 409) throw new Error(`bucket-create:${created.status}:${await created.text()}`);
}
export async function POST(request: Request) {
  const seller = await getApprovedSeller();
  if (!seller) return NextResponse.json({ error: "Görsel yüklemek için onaylı satıcı olmalısınız." }, { status: 403 });
  const config = storageConfig();
  if (!config) return NextResponse.json({ error: "Görsel depolama henüz yapılandırılmamış." }, { status: 503 });
  const formData = await request.formData().catch(() => null);
  const files = formData?.getAll("files").filter((value): value is File => value instanceof File) ?? [];
  if (!files.length || files.length > MAX_FILES) return NextResponse.json({ error: "Bir ürüne 1 ile 8 arasında görsel ekleyebilirsiniz." }, { status: 400 });
  if (files.some(file => !allowedTypes.has(file.type) || file.size > MAX_SIZE)) return NextResponse.json({ error: "Görseller JPG, PNG veya WEBP olmalı ve her biri en fazla 5 MB olmalıdır." }, { status: 400 });
  try {
    await ensureBucket(config);
    const uploads = [] as { path: string; url: string }[];
    for (const file of files) {
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${seller.id}/${randomUUID()}.${extension}`;
      const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${config.key}`, apikey: config.key, "Content-Type": file.type, "x-upsert": "false" }, body: await file.arrayBuffer() });
      if (!response.ok) throw new Error(`upload:${response.status}:${await response.text()}`);
      uploads.push({ path, url: `${config.url}/storage/v1/object/public/${BUCKET}/${path}` });
    }
    return NextResponse.json({ images: uploads });
  } catch (error) {
    console.error("[product-images] Supabase Storage yükleme hatası", error);
    return NextResponse.json({ error: "Görseller yüklenemedi. Lütfen tekrar deneyin." }, { status: 502 });
  }
}
export async function DELETE(request: Request) {
  const seller = await getApprovedSeller();
  if (!seller) return NextResponse.json({ error: "Satıcı yetkisi gerekli." }, { status: 403 });
  const config = storageConfig(); if (!config) return NextResponse.json({ error: "Görsel depolama yapılandırılmamış." }, { status: 503 });
  const body = await request.json().catch(() => null) as { paths?: unknown } | null;
  const paths = Array.isArray(body?.paths) ? body.paths.filter((path): path is string => typeof path === "string" && path.startsWith(`${seller.id}/`)) : [];
  if (paths.length) await fetch(`${config.url}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: { Authorization: `Bearer ${config.key}`, apikey: config.key, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
  return NextResponse.json({ ok: true });
}
