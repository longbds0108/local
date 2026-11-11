import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import type { ReactNode } from "react";
import Header from "@/components/Header";
import { I18nProvider } from "@/components/I18nProvider";
import MobileNav from "@/components/MobileNav";
import "./globals.css";

// One typeface for the whole app. Be Vietnam Pro is drawn for Vietnamese, so
// accented letters match the plain Latin ones exactly.
const appFont = Be_Vietnam_Pro({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-app",
  display: "swap",
});

export const metadata: Metadata = {
  description: "Hedgora Travel",
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
    <html lang="vi" className={appFont.variable}>
      <body className="min-h-dvh bg-bg text-ink">
        <I18nProvider>
          <Header />
          {/* Bottom padding keeps content clear of the mobile bottom nav. */}
          <main className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
          <MobileNav />
        </I18nProvider>
      </body>
    </html>
  );
}
