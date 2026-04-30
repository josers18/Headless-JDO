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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sf = await getTokenCookie();
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className="bg-bg text-text min-h-dvh pb-[env(safe-area-inset-bottom,0px)]">
        {/*
          Loads synchronously before interactive hydration so first paint sees
          the correct `[data-theme]` overrides. Implemented as a static asset to
          satisfy eslint (no raw sync script tags in JSX).
        */}
        <Script src="/hz-theme-boot.js" strategy="beforeInteractive" />
        <ThemeProvider>
          <SfInstanceProvider instanceUrl={sf?.instance_url ?? null}>
            {children}
          </SfInstanceProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
