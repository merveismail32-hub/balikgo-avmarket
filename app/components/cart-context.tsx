"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { Product } from "@/app/lib/products";

const STORAGE_KEY = "balikgo-cart";
export type CartItem = Product & { quantity: number };
type CartContextValue = { items: CartItem[]; totalItems: number; subtotal: number; isLoaded: boolean; addItem: (product: Product, quantity?: number) => void; increaseQuantity: (productId: string) => void; decreaseQuantity: (productId: string) => void; removeItem: (productId: string) => void; clearCart: () => void; };
const CartContext = createContext<CartContextValue | undefined>(undefined);

function validItem(value: unknown): value is CartItem {
  const item = value as Partial<CartItem>;
  return !!item && typeof item.id === "string" && typeof item.name === "string" && typeof item.price === "string" && typeof item.unitPrice === "number" && typeof item.image === "string" && typeof item.quantity === "number" && Number.isInteger(item.quantity) && item.quantity > 0;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [items, setItems] = useState<CartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [databaseMode, setDatabaseMode] = useState(false);
  const replaceFromResponse = useCallback(async (response: Response) => {
    if (!response.ok) return false;
    const next = await response.json() as CartItem[];
    setItems(Array.isArray(next) ? next.filter(validItem) : []);
    return true;
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      let localItems: CartItem[] = [];
      try { const saved = window.localStorage.getItem(STORAGE_KEY); if (saved) { const parsed: unknown = JSON.parse(saved); if (Array.isArray(parsed)) localItems = parsed.filter(validItem); } } catch { window.localStorage.removeItem(STORAGE_KEY); }
      if (active) setItems(localItems);
      try {
        if (status !== "authenticated" || !session?.user?.id) { if (active) setDatabaseMode(false); return; }
        const remote = await fetch("/api/account/cart");
        if (!remote.ok) return;
        setDatabaseMode(true);
        if (localItems.length) await replaceFromResponse(await fetch("/api/account/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(localItems.map(({ id, quantity }) => ({ id, quantity }))) }));
        else await replaceFromResponse(remote);
      } finally { if (active) setIsLoaded(true); }
    };
    void initialize();
    return () => { active = false; };
  }, [replaceFromResponse, session?.user?.id, status]);
  useEffect(() => { if (isLoaded) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }, [items, isLoaded]);
  const persist = useCallback((next: CartItem[], request?: RequestInit) => { setItems(next); if (databaseMode && request) void fetch("/api/account/cart", request).then(replaceFromResponse).catch(() => undefined); }, [databaseMode, replaceFromResponse]);
  const addItem = useCallback((product: Product, quantity = 1) => setItems(current => { const amount = Math.max(1, Math.floor(quantity)); const max = product.stock ?? Number.MAX_SAFE_INTEGER; const exists = current.find(item => item.id === product.id); const target = Math.min(max, (exists?.quantity ?? 0) + amount); const next = exists ? current.map(item => item.id === product.id ? { ...item, quantity: target } : item) : target ? [...current, { ...product, quantity: target }] : current; if (databaseMode && target) void fetch("/api/account/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify([{ id: product.id, quantity: target }]) }).then(replaceFromResponse).catch(() => undefined); return next; }), [databaseMode, replaceFromResponse]);
  const increaseQuantity = useCallback((id: string) => setItems(current => { const next = current.map(item => item.id === id ? { ...item, quantity: Math.min(item.stock ?? Number.MAX_SAFE_INTEGER, item.quantity + 1) } : item); const quantity = next.find(item => item.id === id)?.quantity; if (databaseMode && quantity) void fetch("/api/account/cart", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: id, quantity }) }).then(replaceFromResponse).catch(() => undefined); return next; }), [databaseMode, replaceFromResponse]);
  const decreaseQuantity = useCallback((id: string) => setItems(current => { const next = current.map(item => item.id === id ? { ...item, quantity: Math.max(1, item.quantity - 1) } : item); const quantity = next.find(item => item.id === id)?.quantity; if (databaseMode && quantity) void fetch("/api/account/cart", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: id, quantity }) }).then(replaceFromResponse).catch(() => undefined); return next; }), [databaseMode, replaceFromResponse]);
  const removeItem = useCallback((id: string) => { setItems(current => current.filter(item => item.id !== id)); if (databaseMode) void fetch(`/api/account/cart?productId=${encodeURIComponent(id)}`, { method: "DELETE" }).then(replaceFromResponse).catch(() => undefined); }, [databaseMode, replaceFromResponse]);
  const clearCart = useCallback(() => { setItems([]); if (databaseMode) void fetch("/api/account/cart", { method: "DELETE" }).then(replaceFromResponse).catch(() => undefined); }, [databaseMode, replaceFromResponse]);
  const value = useMemo(() => ({ items, totalItems: items.reduce((total, item) => total + item.quantity, 0), subtotal: items.reduce((total, item) => total + item.unitPrice * item.quantity, 0), isLoaded, addItem, increaseQuantity, decreaseQuantity, removeItem, clearCart }), [items, isLoaded, addItem, increaseQuantity, decreaseQuantity, removeItem, clearCart]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
export function useCart() { const context = useContext(CartContext); if (!context) throw new Error("useCart must be used within a CartProvider"); return context; }
