import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Horizon",
  description:
    "The headless home page for the relationship banker. Built on Salesforce Headless 360.",
  applicationName: "Horizon",
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
  return (
    <html lang="en" className="dark">
      <body className="bg-bg text-text min-h-dvh pb-[env(safe-area-inset-bottom,0px)]">
        {children}
      </body>
    </html>
  );
}
