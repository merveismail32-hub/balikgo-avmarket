"use client";

import { FormEvent, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

const MAX_FILES = 8;
const MAX_SIZE = 5 * 1024 * 1024;
const allowed = ["image/jpeg", "image/png", "image/webp"];

type Option = { id: string; name: string };
export function SellerProductForm({ categories, brands }: { categories: Option[]; brands: Option[] }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);

  function choose(selected: FileList | null) {
    const next = [...files, ...Array.from(selected ?? [])];
    if (next.length > MAX_FILES) {
      setError("Bir ürüne en fazla 8 fotoğraf ekleyebilirsiniz.");
      return;
    }
    if (next.some((file) => !allowed.includes(file.type) || file.size > MAX_SIZE)) {
      setError("Fotoğraflar JPG, PNG veya WEBP olmalı; her biri en fazla 5 MB olmalıdır.");
      return;
    }
    setError("");
    setFiles(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!files.length) {
      setError("En az bir ürün fotoğrafı seçin.");
      return;
    }
    setSaving(true);
    setError("");
    let uploaded: { path: string; url: string }[] = [];
    try {
      setUploading(true);
      const uploadData = new FormData();
      files.forEach((file) => uploadData.append("files", file));
      const uploadResponse = await fetch("/api/seller/product-images", { method: "POST", body: uploadData });
      const uploadResult = await uploadResponse.json() as { images?: typeof uploaded; error?: string };
      setUploading(false);
      if (!uploadResponse.ok || !uploadResult.images) throw new Error(uploadResult.error ?? "Görseller yüklenemedi.");
      uploaded = uploadResult.images;
      const formData = new FormData(form);
      const payload = { ...Object.fromEntries(formData), imageUrl: uploaded[0].url, images: uploaded.map((image) => image.url) };
      const productResponse = await fetch("/api/seller/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const productResult = await productResponse.json().catch(() => ({})) as { error?: string };
      if (!productResponse.ok) throw new Error(productResult.error ?? "Ürün kaydedilemedi.");
      router.push("/satici-panel/urunler");
      router.refresh();
    } catch (reason) {
      if (uploaded.length) void fetch("/api/seller/product-images", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: uploaded.map((image) => image.path) }) });
      setError(reason instanceof Error ? reason.message : "Ürün kaydedilemedi.");
    } finally {
      setUploading(false);
      setSaving(false);
    }
  }

  const input = "mt-2 w-full rounded-xl border border-slate-200 px-4 py-3.5 text-sm outline-none focus:border-sky-500";
  return <form onSubmit={submit} className="max-w-4xl rounded-2xl border bg-white p-5 shadow-sm sm:p-7">
    <div className="grid gap-5 sm:grid-cols-2">
      <label className="block text-sm font-bold sm:col-span-2">Ürün adı<input required name="name" className={input} /></label>
      <label className="block text-sm font-bold">SKU / Stok Kodu<input name="sku" maxLength={80} placeholder="Örn. MISINA-001" className={input} /><span className="mt-2 block text-xs font-normal text-slate-500">İsteğe bağlıdır. Mağazanız içinde benzersiz olmalıdır.</span></label>
      <label className="block text-sm font-bold">Kategori<select required name="categoryId" defaultValue="" className={input}><option value="" disabled>Aktif kategori seçin</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="block text-sm font-bold">Marka<select name="brandId" defaultValue="" className={input}><option value="">Markasız / Seçilmedi</option>{brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="block text-sm font-bold">Satış fiyatı<input required name="price" type="number" min="1" step="0.01" className={input} /></label>
      <label className="block text-sm font-bold">Eski fiyat<input name="oldPrice" type="number" min="1" step="0.01" className={input} /></label>
      <label className="block text-sm font-bold">Stok<input required name="stock" type="number" min="0" className={input} /></label>
      <label className="block text-sm font-bold">Kargo bilgileri<input name="shippingInfo" placeholder="Örn. Aynı gün kargo" className={input} /></label>
      <div className="sm:col-span-2">
        <label className="block rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm font-bold text-slate-700 hover:border-sky-400"><span>Ürün fotoğraflarını seçin (en fazla 8)</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => choose(event.target.files)} className="sr-only" /></label>
        <p className="mt-2 text-xs text-slate-500">İlk fotoğraf kapak görseli olur. JPG, JPEG, PNG veya WEBP; her biri en fazla 5 MB.</p>
        {previews.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{previews.map(({ file, url }, index) => <div key={`${file.name}-${index}`} className="relative overflow-hidden rounded-xl border bg-slate-50"><Image src={url} alt="Seçilen ürün fotoğrafı" width={300} height={300} unoptimized className="aspect-square w-full object-cover" />{index === 0 && <span className="absolute left-2 top-2 rounded bg-sky-500 px-2 py-1 text-[10px] font-bold text-white">Kapak</span>}<button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-2 top-2 rounded bg-white px-2 py-1 text-xs font-bold text-red-500 shadow">Kaldır</button></div>)}</div>}
      </div>
      <label className="block text-sm font-bold sm:col-span-2">Ürün açıklaması<textarea required name="description" rows={5} className={input} /></label>
      <label className="block text-sm font-bold sm:col-span-2">Teknik özellikler<textarea name="technicalDetails" rows={4} className={input} /></label>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600 sm:col-span-2">{error}</p>}
      {uploading && <p className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-700 sm:col-span-2">Görseller yükleniyor...</p>}
      <button disabled={saving} className="rounded-xl bg-sky-500 py-4 font-bold text-white shadow-lg shadow-sky-500/20 disabled:opacity-60 sm:col-span-2">{saving ? "Kaydediliyor..." : "Ürünü Kaydet"}</button>
    </div>
  </form>;
}
