import "@fontsource-variable/figtree";
import "./globals.css";

import type { Metadata, Viewport } from "next";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Bar & Restaurant",
  description: "Billing, stock, rooms and reports for the bar and restaurant.",
  applicationName: "Bar & Restaurant",
  appleWebApp: {
    capable: true,
    title: "Bar POS",
    statusBarStyle: "black-translucent",
  },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#163029",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
