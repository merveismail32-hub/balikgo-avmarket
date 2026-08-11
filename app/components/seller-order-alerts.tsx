"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ActivityOrder = { id: string; orderNumber: string; createdAt: string };
type ActivityResponse = { orders?: ActivityOrder[]; serverTime?: string };

const SOUND_KEY = "balikgo-seller-order-sound";
const UNREAD_KEY = "balikgo-seller-order-unread";
const POLL_INTERVAL_MS = 15_000;

const menuItems = [
  { href: "/satici-panel", label: "Genel Bakış", icon: "◦", exact: true },
  { href: "/satici-panel/urunler", label: "Ürünlerim", icon: "◫" },
  { href: "/satici-panel/stok-fiyat", label: "Stok & Fiyat", icon: "₺" },
  { href: "/satici-panel/urun-ekle", label: "Ürün Ekle", icon: "+" },
  { href: "/satici-panel/siparisler", label: "Siparişler", icon: "□", orders: true },
  { href: "/satici-panel/satislar", label: "Satışlar", icon: "↗" },
  { href: "/satici-panel/yorumlar", label: "Yorumlar", icon: "★" },
  { href: "#", label: "Kampanyalar", icon: "✦" },
  { href: "#", label: "Mağaza Bilgileri", icon: "◉" },
  { href: "/satici-panel/odemeler", label: "Finans & Hakediş", icon: "₺" },
];

function playOrderSound() {
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.34);
  oscillator.addEventListener("ended", () => void context.close(), { once: true });
}

export function SellerOrderAlerts() {
  const pathname = usePathname();
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<ActivityOrder | null>(null);
  const cursorRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const inFlightRef = useRef(false);
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSoundEnabled(window.localStorage.getItem(SOUND_KEY) === "true");
      const saved = Number.parseInt(window.localStorage.getItem(UNREAD_KEY) ?? "0", 10);
      setUnread(Number.isFinite(saved) && saved > 0 ? saved : 0);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!pathname.startsWith("/satici-panel/siparisler")) return;
    const timeout = window.setTimeout(() => setUnread(0), 0);
    window.localStorage.setItem(UNREAD_KEY, "0");
    return () => window.clearTimeout(timeout);
  }, [pathname]);

  useEffect(() => {
    const controller = new AbortController();
    async function poll() {
      if (inFlightRef.current || document.visibilityState === "hidden") return;
      inFlightRef.current = true;
      try {
        const query = cursorRef.current ? `?after=${encodeURIComponent(cursorRef.current)}` : "";
        const response = await fetch(`/api/seller/orders/activity${query}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const body = await response.json() as ActivityResponse;
        if (!body.serverTime || !Array.isArray(body.orders)) return;
        if (!initializedRef.current) {
          body.orders.forEach((order) => seenRef.current.add(order.id));
          initializedRef.current = true;
        } else {
          const fresh = body.orders.filter((order) => !seenRef.current.has(order.id));
          body.orders.forEach((order) => seenRef.current.add(order.id));
          if (fresh.length) {
            setToast(fresh[0]);
            setUnread((current) => {
              const next = pathname.startsWith("/satici-panel/siparisler") ? 0 : current + fresh.length;
              window.localStorage.setItem(UNREAD_KEY, String(next));
              return next;
            });
            if (window.localStorage.getItem(SOUND_KEY) === "true") {
              try { playOrderSound(); } catch { /* Browser audio policy may reject playback. */ }
            }
          }
        }
        cursorRef.current = body.serverTime;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      } finally {
        inFlightRef.current = false;
      }
    }
    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [pathname]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 6_000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    window.localStorage.setItem(SOUND_KEY, String(next));
    if (next) try { playOrderSound(); } catch { /* Audio remains optional. */ }
  }

  return <>
    <nav className="flex max-w-full gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">{menuItems.map((item) => {
      const active = item.href !== "#" && (item.exact ? pathname === item.href : pathname.startsWith(item.href));
      return <Link key={item.label} href={item.href} aria-current={active ? "page" : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition ${active ? "bg-sky-500 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}><span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-sm">{item.icon}</span><span>{item.label}</span>{item.orders && unread > 0 && <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-black text-white">{unread > 99 ? "99+" : unread}</span>}</Link>;
    })}</nav>
    <button type="button" onClick={toggleSound} aria-pressed={soundEnabled} className="mt-4 w-full rounded-xl border border-white/10 px-4 py-3 text-left text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white">Yeni sipariş sesi: {soundEnabled ? "Açık" : "Kapalı"}</button>
    {toast && <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-50 w-[min(360px,calc(100vw-2.5rem))] rounded-2xl border border-sky-200 bg-white p-5 text-slate-900 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-sky-700">Yeni sipariş geldi!</p><p className="mt-1 text-sm font-semibold">Sipariş #{toast.orderNumber}</p></div><button type="button" onClick={() => setToast(null)} aria-label="Bildirimi kapat" className="text-xl text-slate-400">×</button></div><Link href={`/satici-panel/siparisler/${toast.id}`} onClick={() => setToast(null)} className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white">Siparişi görüntüle</Link></div>}
  </>;
}
