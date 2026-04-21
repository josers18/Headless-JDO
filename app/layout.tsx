import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { getTokenCookie } from "@/lib/salesforce/token";
import { SfInstanceProvider } from "@/components/horizon/SfInstanceProvider";
import { ThemeProvider } from "@/lib/client/ThemeProvider";

export const metadata: Metadata = {
  title: "Horizon",
  description:
    "The headless home page for the relationship banker. Built on Salesforce Headless 360.",
  applicationName: "Horizon",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0B0D",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sf = getTokenCookie();
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className="bg-bg text-text min-h-dvh pb-[env(safe-area-inset-bottom,0px)]">
        {/*
          Set `data-theme` before React hydrates so first paint + CSS
          `[data-theme=…]` blocks match. Client `ThemeProvider` then keeps
          the attribute in sync and owns localStorage.
        */}
        <Script id="hz-theme-boot" strategy="beforeInteractive">
          {`(function(){try{var k="hz-theme",DEF="horizon-dark",L="ivory",d=document.documentElement,t=localStorage.getItem(k);if(!t){t=window.matchMedia("(prefers-color-scheme: light)").matches?L:DEF;}d.setAttribute("data-theme",t);}catch(e){}})();`}
        </Script>
        <ThemeProvider>
          <SfInstanceProvider instanceUrl={sf?.instance_url ?? null}>
            {children}
          </SfInstanceProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
