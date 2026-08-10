import Link from "next/link";

export function AccountHeader() {
  return (
    <>
      <div className="bg-slate-950 px-5 py-2 text-center text-sm font-medium text-white">
        🎣 BalıkGo AvMarket&apos;e hoş geldin! | Türkiye&apos;nin balıkçılık pazaryeri
      </div>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5">
          <Link href="/" className="min-w-fit">
            <div className="text-2xl font-black text-sky-600">BALIK<span className="text-slate-950">GO</span></div>
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">AvMarket</div>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link href="/" className="rounded-xl px-3 py-3 text-sm font-bold transition hover:bg-slate-100 sm:px-4">🏠 <span className="hidden sm:inline">Ana Sayfa</span></Link>
            <Link href="/giris" className="rounded-xl px-3 py-3 text-sm font-bold transition hover:bg-slate-100 sm:px-4">Giriş Yap</Link>
            <Link href="/kayit" className="rounded-xl bg-slate-950 px-3 py-3 text-sm font-bold text-white transition hover:bg-sky-600 sm:px-4">Üye Ol</Link>
          </nav>
        </div>
      </header>
    </>
  );
}
