import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CartProvider } from "./components/cart-context";
import { FavoriteProvider } from "./components/favorite-context";
import { AuthSessionProvider } from "./components/auth-session-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "BalıkGo AvMarket | Balıkçılık Ekipmanları Pazaryeri", template: "%s | BalıkGo AvMarket" },
  description: "Olta, makine, misina, yem ve balıkçılık ekipmanlarını farklı mağazalardan güvenle keşfedin.",
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "tr_TR", siteName: "BalıkGo AvMarket" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthSessionProvider>
          <CartProvider>
            <FavoriteProvider>{children}</FavoriteProvider>
          </CartProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
