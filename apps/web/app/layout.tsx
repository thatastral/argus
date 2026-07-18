import type { Metadata, Viewport } from "next";
import { DM_Sans, Rakkas } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

// Wordmark only ("Argus" in the header) — Rakkas ships weight 400 only.
const rakkas = Rakkas({
  variable: "--font-rakkas",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Argus",
  description: "Your AI-powered accountability wallet on Monad.",
};

// Explicit rather than relying on Next's implicit default — this app has zero mobile handling
// otherwise, so this is the one true prerequisite for any of it to render at the right scale.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${rakkas.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
