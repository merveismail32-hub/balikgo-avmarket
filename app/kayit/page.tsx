"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { AccountHeader } from "../components/account-header";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("passwordConfirmation") ?? "")) { setError("Şifre ve şifre tekrarı aynı olmalıdır."); return; }
    if (password.length < 8) { setError("Şifre en az 8 karakter olmalıdır."); return; }
    if (!form.get("acceptedTerms")) { setError("Üyelik sözleşmesini onaylamalısınız."); return; }
    setIsSubmitting(true);
    const response = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), surname: form.get("surname"), email: form.get("email"), phone: form.get("phone"), password, acceptedTerms: true }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(data.error ?? "Kayıt işlemi tamamlanamadı."); setIsSubmitting(false); return; }
    const signedIn = await signIn("credentials", { redirect: false, email: String(form.get("email") ?? ""), password });
    setIsSubmitting(false);
    if (signedIn?.error) { router.push("/giris"); return; }
    router.push("/hesabim"); router.refresh();
  }
  const input = "mt-2 w-full rounded-xl border border-slate-200 px-4 py-3.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100";
  return <main className="min-h-screen bg-slate-50 text-slate-900"><AccountHeader /><section className="mx-auto flex max-w-5xl justify-center px-5 py-12 sm:py-16"><div className="w-full max-w-2xl rounded-3xl border bg-white p-6 shadow-sm sm:p-9"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-2xl">🎣</div><p className="mt-6 text-sm font-bold uppercase tracking-wider text-sky-600">BALIKGO'YA KATIL</p><h1 className="mt-2 text-3xl font-black">Üye Ol</h1><p className="mt-3 text-sm leading-6 text-slate-500">Balıkçılık alışverişini kolaylaştıracak hesabını birkaç adımda oluştur.</p><form onSubmit={handleSubmit} className="mt-7 grid gap-5 sm:grid-cols-2"><label className="block text-sm font-bold">Ad<input required name="name" type="text" minLength={2} autoComplete="given-name" placeholder="Adınız" className={input} /></label><label className="block text-sm font-bold">Soyad<input required name="surname" type="text" minLength={2} autoComplete="family-name" placeholder="Soyadınız" className={input} /></label><label className="block text-sm font-bold sm:col-span-2">E-posta<input required name="email" type="email" autoComplete="email" placeholder="ornek@eposta.com" className={input} /></label><label className="block text-sm font-bold sm:col-span-2">Telefon<input required name="phone" type="tel" minLength={10} autoComplete="tel" placeholder="05XX XXX XX XX" className={input} /></label><label className="block text-sm font-bold">Şifre<input required name="password" type="password" minLength={8} autoComplete="new-password" placeholder="Şifre oluşturun" className={input} /></label><label className="block text-sm font-bold">Şifre tekrar<input required name="passwordConfirmation" type="password" minLength={8} autoComplete="new-password" placeholder="Şifrenizi tekrar girin" className={input} /></label><label className="flex items-start gap-3 text-sm leading-6 text-slate-600 sm:col-span-2"><input required name="acceptedTerms" type="checkbox" className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-500" /><span>Üyelik sözleşmesini ve kişisel verilerimin işlenmesine ilişkin aydınlatma metnini okudum, onaylıyorum.</span></label>{error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 sm:col-span-2">{error}</p>}<button disabled={isSubmitting} className="rounded-xl bg-sky-500 py-4 font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-70 sm:col-span-2">{isSubmitting ? "Hesap oluşturuluyor..." : "Üye Ol"}</button></form><p className="mt-7 border-t pt-6 text-center text-sm text-slate-500">Zaten hesabın var mı? <Link href="/giris" className="font-bold text-sky-600 hover:text-sky-700">Giriş Yap</Link></p></div></section></main>;
}
