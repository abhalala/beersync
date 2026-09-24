import { PostHogProvider } from "@/components/PostHogProvider";
import TQProvider from "@/components/TQProvider";
import { Toaster } from "@/components/ui/sonner";
import { IS_DEMO_MODE } from "@/lib/demo";
import { cn } from "@/lib/utils";
import { Analytics } from "@vercel/analytics/react";
import type { Metadata } from "next";
import { Chakra_Petch, Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face for console labels and readouts (mixer-silkscreen feel)
const chakraPetch = Chakra_Petch({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Beersync",
  description:
    "Co-DJ in the browser. Beersync is a multiplayer DJ console where everyone mixes the same decks and every device plays the mix in sync.",
  keywords: ["dj", "music", "sync", "audio", "collaboration", "real-time", "rekordbox", "b2b"],
  authors: [{ name: "Freeman Jiang" }],
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Beersync",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body
        className={cn(
          geistSans.variable,
          geistMono.variable,
          inter.variable,
          chakraPetch.variable,
          "antialiased font-sans selection:bg-primary-800 selection:text-white"
        )}
      >
        <PostHogProvider>
          <TQProvider>
            {children}
            <Toaster />
            {!IS_DEMO_MODE && <Analytics />}
          </TQProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
