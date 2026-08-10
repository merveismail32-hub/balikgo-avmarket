import Link from "next/link";

export function AccountLink({ className = "" }: { className?: string }) {
  return (
    <Link href="/hesabim" className={`inline-flex items-center justify-center gap-2 ${className}`}>
      <span aria-hidden="true">👤</span>
      <span className="hidden sm:inline">Hesabım</span>
    </Link>
  );
}
