import Link from "next/link";
import { queryHref } from "@/app/lib/listing";

type Option = { name: string; slug: string };
type Query = Record<string, string | string[] | undefined>;

export function ListingControls({
  action,
  query,
  categories = [],
  brands = [],
}: {
  action: string;
  query: Query;
  categories?: Option[];
  brands?: Option[];
}) {
  const value = (key: string) =>
    typeof query[key] === "string" ? query[key] : "";

  return (
    <form
      action={action}
      className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <label className="text-sm font-bold">
        Arama
        <input
          name="q"
          maxLength={100}
          defaultValue={value("q")}
          className="mt-1 w-full rounded-xl border p-3"
        />
      </label>
      {categories.length > 0 && (
        <label className="text-sm font-bold">
          Kategori
          <select
            name="category"
            defaultValue={value("category")}
            className="mt-1 w-full rounded-xl border bg-white p-3"
          >
            <option value="">Tümü</option>
            {categories.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {brands.length > 0 && (
        <label className="text-sm font-bold">
          Marka
          <select
            name="brand"
            defaultValue={value("brand")}
            className="mt-1 w-full rounded-xl border bg-white p-3"
          >
            <option value="">Tümü</option>
            {brands.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm font-bold">
        Minimum fiyat
        <input
          name="minPrice"
          type="number"
          min="0"
          defaultValue={value("minPrice")}
          className="mt-1 w-full rounded-xl border p-3"
        />
      </label>
      <label className="text-sm font-bold">
        Maksimum fiyat
        <input
          name="maxPrice"
          type="number"
          min="0"
          defaultValue={value("maxPrice")}
          className="mt-1 w-full rounded-xl border p-3"
        />
      </label>
      <label className="text-sm font-bold">
        Minimum puan
        <select
          name="rating"
          defaultValue={value("rating")}
          className="mt-1 w-full rounded-xl border bg-white p-3"
        >
          <option value="">Tümü</option>
          {[5, 4, 3, 2, 1].map((rating) => (
            <option key={rating}>{rating}</option>
          ))}
        </select>
      </label>
      <label className="text-sm font-bold">
        Sıralama
        <select
          name="sort"
          defaultValue={value("sort")}
          className="mt-1 w-full rounded-xl border bg-white p-3"
        >
          <option value="recommended">Önerilen</option>
          <option value="price_asc">Fiyat artan</option>
          <option value="price_desc">Fiyat azalan</option>
          <option value="newest">En yeni</option>
          <option value="rating_desc">En yüksek puan</option>
        </select>
      </label>
      <label className="flex items-center gap-2 self-end rounded-xl border p-3 text-sm font-bold">
        <input
          name="inStock"
          value="1"
          type="checkbox"
          defaultChecked={
            value("inStock") === "1" || value("inStock") === "true"
          }
        />
        Yalnızca stokta
      </label>
      <div className="flex items-end gap-2">
        <button className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">
          Uygula
        </button>
        <Link href={action} className="rounded-xl border px-5 py-3 font-bold">
          Temizle
        </Link>
      </div>
    </form>
  );
}

export function Pagination({
  path,
  query,
  page,
  total,
}: {
  path: string;
  query: Query;
  page: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / 24));

  return (
    <nav aria-label="Sayfalama" className="mt-8 flex justify-between">
      <Link
        aria-disabled={page <= 1}
        className={page <= 1 ? "pointer-events-none opacity-40" : ""}
        href={queryHref(path, query, page - 1)}
      >
        ← Önceki
      </Link>
      <span aria-current="page">
        Sayfa {Math.min(page, pages)} / {pages}
      </span>
      <Link
        aria-disabled={page >= pages}
        className={page >= pages ? "pointer-events-none opacity-40" : ""}
        href={queryHref(path, query, page + 1)}
      >
        Sonraki →
      </Link>
    </nav>
  );
}
