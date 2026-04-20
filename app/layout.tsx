import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getTokenCookie } from "@/lib/salesforce/token";
import { SfInstanceProvider } from "@/components/horizon/SfInstanceProvider";

export const metadata: Metadata = {
  title: "Cumulus Bank Horizon",
  description:
    "The headless home page for the relationship banker. Built on Salesforce Headless 360.",
  applicationName: "Cumulus Bank Horizon",
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
    <html lang="en" className="dark">
      <body className="bg-bg text-text min-h-dvh pb-[env(safe-area-inset-bottom,0px)]">
        <SfInstanceProvider instanceUrl={sf?.instance_url ?? null}>
          {children}
        </SfInstanceProvider>
      </body>
    </html>
  );
}
