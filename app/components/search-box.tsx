"use client";

import { useEffect, useRef, useState } from "react";

type SearchBoxProps = {
  initialQuery?: string;
};

export function SearchBox({ initialQuery = "" }: SearchBoxProps) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  function clearSearch() {
    setQuery("");
    inputRef.current?.focus();
  }

  return (
    <form
      role="search"
      action="/arama"
      method="get"
      className="flex items-center rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 transition focus-within:border-sky-500"
    >
      <span className="mr-3 text-lg" aria-hidden="true">🔎</span>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        name="q"
        type="search"
        placeholder="Ürün, marka veya kategori ara..."
        aria-label="Ürün, marka veya kategori ara"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
      {query && (
        <button
          type="button"
          onClick={clearSearch}
          aria-label="Aramayı temizle"
          className="ml-2 rounded-md px-1 text-lg leading-none text-slate-400 transition hover:text-slate-950"
        >
          ×
        </button>
      )}
      <button
        type="submit"
        aria-label="Ara"
        className="ml-2 rounded-lg bg-sky-500 px-2 py-1 text-sm font-bold text-white transition hover:bg-sky-600"
      >
        →
      </button>
    </form>
  );
}
