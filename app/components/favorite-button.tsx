"use client";

import Link from "next/link";
import type { Product } from "@/app/lib/products";
import { useFavorites } from "./favorite-context";

type FavoriteButtonProps = {
  product: Product;
  className?: string;
};

export function FavoriteButton({ product, className = "" }: FavoriteButtonProps) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const active = isFavorite(product.id);

  return (
    <button
      type="button"
      aria-label={active ? `${product.name} ürününü favorilerden çıkar` : `${product.name} ürününü favorilere ekle`}
      aria-pressed={active}
      onClick={() => toggleFavorite(product)}
      className={`${className} ${active ? "text-red-500" : "text-slate-700"}`}
    >
      {active ? "♥" : "♡"}
    </button>
  );
}

type FavoriteAccessButtonProps = {
  className?: string;
};

export function FavoriteAccessButton({ className = "" }: FavoriteAccessButtonProps) {
  const { totalFavorites } = useFavorites();

  return (
    <Link
      href="/favoriler"
      aria-label={`Favoriler, ${totalFavorites} ürün`}
      className={`relative inline-flex items-center justify-center ${className}`}
    >
      <span aria-hidden="true">♥</span>
      <span className="hidden sm:inline">Favoriler</span>
      <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] text-white">
        {totalFavorites}
      </span>
    </Link>
  );
}
