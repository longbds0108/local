import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, DM_Sans, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import Header from "@/components/Header";
import { I18nProvider } from "@/components/I18nProvider";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-dm-sans", display: "swap" });
const manrope = Manrope({ subsets: ["latin", "latin-ext", "vietnamese"], weight: ["600", "700", "800"], variable: "--font-manrope", display: "swap" });
// Vietnamese glyph fallback for DM Sans (it has no Vietnamese subset).
const beVietnam = Be_Vietnam_Pro({ subsets: ["vietnamese"], weight: ["400", "500", "600", "700"], variable: "--font-be-vietnam", display: "swap" });

export const metadata: Metadata = {
  title: "Hedgora Travel — AI local guide",
  description: "Trợ lý AI du lịch Vũng Tàu — lịch trình, ký quỹ USDC trên Arc testnet, check-in QR.",
  applicationName: "Hedgora Travel",
  appleWebApp: { capable: true, title: "Hedgora", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#061513",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={`${dmSans.variable} ${manrope.variable} ${beVietnam.variable}`}>
      <body className="min-h-dvh bg-bg text-ink">
        <I18nProvider>
          <Header />
          <main>{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
