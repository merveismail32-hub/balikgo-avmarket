"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { AccountHeader } from "../components/account-header";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const result = await signIn("credentials", { redirect: false, email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") });
    setIsSubmitting(false);
    if (result?.error) { setError("E-posta veya şifreniz hatalı."); return; }
    const requestedPath = new URLSearchParams(window.location.search).get("callbackUrl");
    let callbackPath = "/hesabim";
    if (requestedPath?.startsWith("/") && !requestedPath.startsWith("//")) {
      const callbackUrl = new URL(requestedPath, window.location.origin);
      if (callbackUrl.origin === window.location.origin) {
        callbackPath = `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`;
      }
    }
    router.push(callbackPath); router.refresh();
  }

  return <main className="min-h-screen bg-slate-50 text-slate-900"><AccountHeader /><section className="mx-auto flex max-w-5xl justify-center px-5 py-12 sm:py-20"><div className="w-full max-w-md rounded-3xl border bg-white p-6 shadow-sm sm:p-9"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-2xl">👤</div><p className="mt-6 text-sm font-bold uppercase tracking-wider text-sky-600">BALIKGO HESABIN</p><h1 className="mt-2 text-3xl font-black">Giriş Yap</h1><p className="mt-3 text-sm leading-6 text-slate-500">Hesabına giriş yaparak sepetini ve favorilerini her zaman kolayca yönet.</p><form onSubmit={handleSubmit} className="mt-7 space-y-5"><label className="block text-sm font-bold">E-posta<input name="email" required type="email" autoComplete="email" placeholder="ornek@eposta.com" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label><label className="block text-sm font-bold">Şifre<input name="password" required type="password" autoComplete="current-password" placeholder="Şifrenizi girin" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label><div className="text-right"><Link href="#" className="text-sm font-bold text-sky-600 hover:text-sky-700">Şifremi unuttum</Link></div>{error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}<button disabled={isSubmitting} className="w-full rounded-xl bg-sky-500 py-4 font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-70">{isSubmitting ? "Giriş yapılıyor..." : "Giriş Yap"}</button></form><p className="mt-7 border-t pt-6 text-center text-sm text-slate-500">Hesabın yok mu? <Link href="/kayit" className="font-bold text-sky-600 hover:text-sky-700">Üye Ol</Link></p></div></section></main>;
}
