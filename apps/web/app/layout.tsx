import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import type { ReactNode } from "react";
import Footer from "@/components/Footer";
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

// Older builds stored keys as hedgora.* and then payagent.*; move them to toura.* before the app starts.
const MIGRATE_STORAGE = `try{for(const st of [localStorage,sessionStorage]){for(const k of Object.keys(st)){const p=k.indexOf("hedgora.")===0?8:k.indexOf("payagent.")===0?9:0;if(p){const n="toura."+k.slice(p);if(st.getItem(n)===null)st.setItem(n,st.getItem(k));st.removeItem(k);}}}}catch(e){}`;

export const metadata: Metadata = {
  description: "Toura — AI travel planner that pays each place in USDC only when you arrive",
  applicationName: "Toura",
  appleWebApp: { capable: true, title: "Toura", statusBarStyle: "black-translucent" },
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
      <head>
        {/* Runs before the app: moves data saved under the old name (wallet session, check-in
            codes, drafts, language) to the new keys, so nobody loses a wallet or a code. */}
        <script dangerouslySetInnerHTML={{ __html: MIGRATE_STORAGE }} />
      </head>
      <body className="min-h-dvh bg-bg text-ink">
        <I18nProvider>
          <Header />
          {/* Bottom padding keeps content clear of the mobile bottom nav. */}
          <main>{children}</main>
          <Footer />
          {/* Keeps the footer clear of the mobile bottom nav. */}
          <div className="h-[calc(4rem+env(safe-area-inset-bottom))] md:hidden" aria-hidden />
          <MobileNav />
        </I18nProvider>
      </body>
    </html>
  );
}
