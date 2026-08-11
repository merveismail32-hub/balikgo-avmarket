import type { Metadata } from "next";
export const metadata: Metadata = { title: "Ödeme", robots: { index: false, follow: false, nocache: true } };
export default function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }

