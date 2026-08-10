"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  async function handleSignOut() {
    window.localStorage.removeItem("balikgo-cart");
    window.localStorage.removeItem("balikgo-favorites");
    await signOut({ callbackUrl: "/" });
  }

  return <button type="button" onClick={() => void handleSignOut()} className="flex items-center gap-3 text-sm font-bold text-red-500 transition hover:text-red-700"><span className="text-xl">↪</span> Çıkış Yap</button>;
}
