import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { TouchActiveEnabler } from "@/components/TouchActiveEnabler";
import { PageTracker } from "@/components/Analytics/PageTracker";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Where in the world is Kara?",
  description: "A live map of Kara on her 26/27 travels.",
  metadataBase: new URL("https://whereiskara.com"),
};

// Header/Footer show the live trip-day counter, which must stay fresh across requests.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-text-primary">
        <TouchActiveEnabler />
        <PageTracker />
        <Header />
        <main className="flex-1 min-h-0">{children}</main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
