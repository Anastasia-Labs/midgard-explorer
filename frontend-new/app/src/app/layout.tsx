import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "../components/shell/AppShell";
import { WebVitals } from "../components/shell/WebVitals";
import { assertNetworkConfigured } from "../lib/network";
import { Providers } from "./providers";
import "./globals.css";

// Fails the production build when the deployment did not declare its network.
assertNetworkConfigured();

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Midgard Explorer",
    template: "%s · Midgard Explorer",
  },
  description:
    "Block explorer for the Midgard L2: blocks, transactions, addresses, deposits, withdrawals, and forced transactions.",
  openGraph: {
    siteName: "Midgard Explorer",
    type: "website",
  },
};

/** Applies the persisted theme before first paint to avoid a flash. */
const themeInit = `try{var t=localStorage.getItem("mg_theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <Providers>
          <WebVitals />
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
