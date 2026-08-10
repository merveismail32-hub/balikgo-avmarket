"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { Product } from "@/app/lib/products";

const STORAGE_KEY = "balikgo-favorites";
type FavoriteContextValue = { favorites: Product[]; totalFavorites: number; isLoaded: boolean; isFavorite: (productId: string) => boolean; toggleFavorite: (product: Product) => void; removeFavorite: (productId: string) => void; };
const FavoriteContext = createContext<FavoriteContextValue | undefined>(undefined);
function validProduct(value: unknown): value is Product { const product = value as Partial<Product>; return !!product && typeof product.id === "string" && typeof product.name === "string" && typeof product.price === "string" && typeof product.unitPrice === "number" && typeof product.image === "string"; }

export function FavoriteProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [favorites, setFavorites] = useState<Product[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [databaseMode, setDatabaseMode] = useState(false);
  const replaceFromResponse = useCallback(async (response: Response) => { if (!response.ok) return false; const next = await response.json() as Product[]; setFavorites(Array.isArray(next) ? next.filter(validProduct) : []); return true; }, []);
  useEffect(() => {
    let active = true;
    const initialize = async () => {
      let localFavorites: Product[] = [];
      try { const saved = window.localStorage.getItem(STORAGE_KEY); if (saved) { const parsed: unknown = JSON.parse(saved); if (Array.isArray(parsed)) localFavorites = parsed.filter(validProduct).filter((product, index, all) => all.findIndex(item => item.id === product.id) === index); } } catch { window.localStorage.removeItem(STORAGE_KEY); }
      if (active) setFavorites(localFavorites);
      try {
        if (status !== "authenticated" || !session?.user?.id) { if (active) setDatabaseMode(false); return; }
        const remote = await fetch("/api/account/favorites");
        if (!remote.ok) return;
        setDatabaseMode(true);
        if (localFavorites.length) await replaceFromResponse(await fetch("/api/account/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(localFavorites.map(product => product.id)) }));
        else await replaceFromResponse(remote);
      } finally { if (active) setIsLoaded(true); }
    };
    void initialize(); return () => { active = false; };
  }, [replaceFromResponse, session?.user?.id, status]);
  useEffect(() => { if (isLoaded) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites)); }, [favorites, isLoaded]);
  const isFavorite = useCallback((id: string) => favorites.some(product => product.id === id), [favorites]);
  const toggleFavorite = useCallback((product: Product) => setFavorites(current => { const exists = current.some(favorite => favorite.id === product.id); const next = exists ? current.filter(favorite => favorite.id !== product.id) : [...current, product]; if (databaseMode) { const request = exists ? fetch(`/api/account/favorites?productId=${encodeURIComponent(product.id)}`, { method: "DELETE" }) : fetch("/api/account/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify([product.id]) }); void request.then(replaceFromResponse).catch(() => undefined); } return next; }), [databaseMode, replaceFromResponse]);
  const removeFavorite = useCallback((id: string) => { setFavorites(current => current.filter(product => product.id !== id)); if (databaseMode) void fetch(`/api/account/favorites?productId=${encodeURIComponent(id)}`, { method: "DELETE" }).then(replaceFromResponse).catch(() => undefined); }, [databaseMode, replaceFromResponse]);
  const value = useMemo(() => ({ favorites, totalFavorites: favorites.length, isLoaded, isFavorite, toggleFavorite, removeFavorite }), [favorites, isLoaded, isFavorite, toggleFavorite, removeFavorite]);
  return <FavoriteContext.Provider value={value}>{children}</FavoriteContext.Provider>;
}
export function useFavorites() { const context = useContext(FavoriteContext); if (!context) throw new Error("useFavorites must be used within a FavoriteProvider"); return context; }
