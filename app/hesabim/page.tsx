import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AccountHeader } from "../components/account-header";
import { SignOutButton } from "../components/sign-out-button";

const panelItems = [
  { icon: "👤", title: "Profil Bilgilerim", text: "Kişisel bilgilerinizi ve iletişim tercihlerinizi düzenleyin." },
  { icon: "📦", title: "Siparişlerim", text: "Siparişlerinizin durumunu ve geçmişini takip edin.", href: "/hesabim/siparisler" },
  { icon: "♥", title: "Favorilerim", text: "Kaydettiğiniz ürünlere hızlıca yeniden göz atın.", href: "/favoriler" },
  { icon: "📍", title: "Adreslerim", text: "Teslimat adreslerinizi yönetin ve yeni adres ekleyin." },
];

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/giris");
  const user = session.user;
  return <main className="min-h-screen bg-slate-50 text-slate-900"><AccountHeader /><section className="mx-auto max-w-5xl px-5 py-10 sm:py-14"><div className="rounded-3xl bg-gradient-to-br from-slate-950 to-sky-950 p-7 text-white shadow-xl sm:p-10"><div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-3xl">👤</div><div><p className="text-sm font-bold text-sky-300">BALIKGO HESABIM</p><h1 className="mt-1 text-3xl font-black">{user.name} {user.surname}</h1><p className="mt-1 text-sm text-slate-300">{user.email}</p></div></div><span className="w-fit rounded-full border border-sky-300/30 bg-sky-400/10 px-4 py-2 text-sm font-bold text-sky-200">Hesabım</span></div></div><div className="mt-8 grid gap-5 sm:grid-cols-2">{panelItems.map((item) => { const content = <><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-100 text-xl text-sky-700">{item.icon}</div><div className="min-w-0"><h2 className="font-black">{item.title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{item.text}</p></div><span className="ml-auto text-xl text-slate-400">›</span></>; return item.href ? <Link key={item.title} href={item.href} className="flex items-center gap-4 rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md">{content}</Link> : <div key={item.title} className="flex items-center gap-4 rounded-2xl border bg-white p-5 shadow-sm">{content}</div>; })}</div><div className="mt-8 rounded-2xl border bg-white p-5 shadow-sm"><SignOutButton /><p className="mt-2 text-xs text-slate-400">Çıkış yaptığınızda bu cihazdaki yerel sepet ve favori verileri temizlenir.</p></div></section></main>;
}
