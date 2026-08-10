"use client";

import Link from "next/link";
import { useCart } from "./cart-context";

type CartButtonProps = {
  className?: string;
};

export function CartButton({ className = "" }: CartButtonProps) {
  const { totalItems } = useCart();

  return (
    <Link
      href="/sepet"
      aria-label={`Sepet, ${totalItems} ürün`}
      className={`relative inline-flex items-center justify-center ${className}`}
    >
      🛒 Sepet
      <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] text-white">
        {totalItems}
      </span>
    </Link>
  );
}
