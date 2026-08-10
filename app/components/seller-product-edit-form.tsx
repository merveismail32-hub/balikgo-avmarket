"use client";

import Image from "next/image";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_FILES = 8;
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

type EditableProduct = {
  id: string;
  name: string;
  category: string;
  brand: string;
  price: number;
  oldPrice: number | null;
  stock: number;
  description: string;
  technicalDetails: string;
  shippingInfo: string;
  active: boolean;
  images: string[];
};

function storagePath(url: string) {
  const marker = "/product-images/";
  const position = url.indexOf(marker);
  return position >= 0 ? decodeURIComponent(url.slice(position + marker.length)) : null;
}

export function SellerProductEditForm({ product }: { product: EditableProduct }) {
  const router = useRouter();
  const [images, setImages] = useState(product.images);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [coverIndex, setCoverIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const previews = useMemo(() => newFiles.map((file) => ({ file, url: URL.createObjectURL(file) })), [newFiles]);
  const allImages = [...images, ...previews.map((preview) => preview.url)];

  function addFiles(list: FileList | null) {
    const next = [...newFiles, ...Array.from(list ?? [])];
    if (images.length + next.length > MAX_FILES) return setError("Bir ürüne en fazla 8 fotoğraf ekleyebilirsiniz.");
    if (next.some((file) => !ALLOWED_TYPES.includes(file.type) || file.size > MAX_SIZE)) return setError("Fotoğraflar JPG, PNG veya WEBP olmalı; her biri en fazla 5 MB olmalıdır.");
    setError("");
    setNewFiles(next);
  }

  function removeImage(index: number) {
    if (allImages.length === 1) return setError("Üründe en az bir görsel kalmalıdır.");
    if (index < images.length) setImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
    else setNewFiles((current) => current.filter((_, itemIndex) => itemIndex !== index - images.length));
    setCoverIndex((current) => current === index ? 0 : current > index ? current - 1 : current);
  }

  async function deleteStorageImages(urls: string[]) {
    const paths = urls.map(storagePath).filter((path): path is string => Boolean(path));
    if (paths.length) await fetch("/api/seller/product-images", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths }) });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!allImages.length) return setError("En az bir ürün fotoğrafı ekleyin.");
    setSaving(true); setError("");
    let uploaded: { path: string; url: string }[] = [];
    const retainedImages = [...images];
    try {
      if (newFiles.length) {
        setUploading(true);
        const uploadData = new FormData();
        newFiles.forEach((file) => uploadData.append("files", file));
        const response = await fetch("/api/seller/product-images", { method: "POST", body: uploadData });
        const result = await response.json().catch(() => ({})) as { images?: typeof uploaded; error?: string };
        setUploading(false);
        if (!response.ok || !result.images) throw new Error(result.error ?? "Görseller yüklenemedi.");
        uploaded = result.images;
      }
      const finalImages = [...retainedImages, ...uploaded.map((image) => image.url)];
      const formData = new FormData(form);
      const payload = {
        ...Object.fromEntries(formData),
        active: formData.get("active") === "on",
        imageUrl: finalImages[Math.min(coverIndex, finalImages.length - 1)],
        images: finalImages,
      };
      const response = await fetch(`/api/seller/products/${product.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Ürün güncellenemedi.");
      const removed = product.images.filter((url) => !retainedImages.includes(url));
      void deleteStorageImages(removed);
      router.push("/satici-panel/urunler");
      router.refresh();
    } catch (reason) {
      if (uploaded.length) void fetch("/api/seller/product-images", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: uploaded.map((image) => image.path) }) });
      setError(reason instanceof Error ? reason.message : "Ürün güncellenemedi.");
    } finally { setUploading(false); setSaving(false); }
  }

  const input = "mt-2 w-full rounded-xl border border-slate-200 px-4 py-3.5 text-sm outline-none focus:border-sky-500";
  return <form onSubmit={submit} className="max-w-4xl rounded-2xl border bg-white p-5 shadow-sm sm:p-7"><div className="grid gap-5 sm:grid-cols-2">
    <label className="block text-sm font-bold sm:col-span-2">Ürün adı<input required name="name" defaultValue={product.name} className={input} /></label>
    <label className="block text-sm font-bold">Kategori<input required name="category" defaultValue={product.category} className={input} /></label>
    <label className="block text-sm font-bold">Marka<input required name="brand" defaultValue={product.brand} className={input} /></label>
    <label className="block text-sm font-bold">Satış fiyatı<input required name="price" type="number" min="1" step="0.01" defaultValue={product.price} className={input} /></label>
    <label className="block text-sm font-bold">Eski fiyat<input name="oldPrice" type="number" min="1" step="0.01" defaultValue={product.oldPrice ?? ""} className={input} /></label>
    <label className="block text-sm font-bold">Stok<input required name="stock" type="number" min="0" defaultValue={product.stock} className={input} /></label>
    <label className="block text-sm font-bold">Kargo bilgileri<input name="shippingInfo" defaultValue={product.shippingInfo} className={input} /></label>
    <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold sm:col-span-2"><input name="active" type="checkbox" defaultChecked={product.active} className="h-4 w-4 accent-sky-500" /> Ürünü müşteri tarafında yayında tut</label>
    <div className="sm:col-span-2"><label className="block rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm font-bold text-slate-700 hover:border-sky-400">Yeni ürün fotoğrafları ekle (en fazla 8)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => addFiles(event.target.files)} className="sr-only" /></label><p className="mt-2 text-xs text-slate-500">Bir görsele “Kapak yap” diyerek ana görseli seçin. JPG, JPEG, PNG veya WEBP; her biri en fazla 5 MB.</p><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{allImages.map((image, index) => <div key={`${image}-${index}`} className="relative overflow-hidden rounded-xl border bg-slate-50"><div className="relative aspect-square"><Image src={image} alt="Ürün görseli" fill className="object-cover" unoptimized={image.startsWith("blob:")} /></div>{coverIndex === index && <span className="absolute left-2 top-2 rounded bg-sky-500 px-2 py-1 text-[10px] font-bold text-white">Kapak</span>}<div className="absolute bottom-2 left-2 right-2 flex gap-1"><button type="button" onClick={() => setCoverIndex(index)} className="rounded bg-white px-2 py-1 text-[10px] font-bold text-sky-700 shadow">Kapak yap</button><button type="button" onClick={() => removeImage(index)} className="rounded bg-white px-2 py-1 text-[10px] font-bold text-red-500 shadow">Kaldır</button></div></div>)}</div></div>
    <label className="block text-sm font-bold sm:col-span-2">Ürün açıklaması<textarea required name="description" rows={5} defaultValue={product.description} className={input} /></label>
    <label className="block text-sm font-bold sm:col-span-2">Teknik özellikler<textarea name="technicalDetails" rows={4} defaultValue={product.technicalDetails} className={input} /></label>
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600 sm:col-span-2">{error}</p>}{uploading && <p className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-700 sm:col-span-2">Görseller yükleniyor...</p>}
    <button disabled={saving} className="rounded-xl bg-sky-500 py-4 font-bold text-white shadow-lg shadow-sky-500/20 disabled:opacity-60 sm:col-span-2">{saving ? "Kaydediliyor..." : "Değişiklikleri Kaydet"}</button>
  </div></form>;
}
