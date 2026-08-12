import type { Metadata } from "next";
import { Geist, Geist_Mono, Platypi } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "../components/shell/AppShell";
import { SourceBanner } from "../components/shell/SourceBanner";
import { WebVitals } from "../components/shell/WebVitals";
import { assertNetworkConfigured } from "../lib/network";
import { Providers } from "./providers";
import "./globals.css";

// Fails the production build when the deployment did not declare its network.
assertNetworkConfigured();

/* Two families across three functional roles.
 *
 * Geist Sans and Geist Mono share a skeleton and proportions, so the prose and
 * the data stop looking like strangers. A monospace is not a style choice
 * here: a hash column needs a fixed advance width, which is the one place the
 * body face cannot do the job.
 *
 * Platypi supplies the carved, angular note for the Midgard brand and top-level
 * page titles only. Its wedge serifs change the register without substituting
 * decorative rune shapes for readable Latin letters. Interface headings,
 * metrics, links and controls stay in Geist Sans.
 */
const geistSans = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist-sans" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});
const platypi = Platypi({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-platypi",
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${platypi.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Nonce hiding is defined platform behaviour: once the browser has
            parsed the element it blanks the content attribute, so
            `getAttribute("nonce")` reads empty while the `.nonce` property
            keeps the value. React's development hydration check reads the
            attribute and has no way to tell that deliberate transformation
            apart from a real mismatch, so it reports one.

            Suppressing here also suppresses a genuine nonce mismatch on this
            element, which is why the guarantee is asserted directly instead:
            see e2e/security-headers.spec.ts, which checks that the header
            nonce and this script's nonce agree, that this script runs, and
            that an inline script without the nonce does not. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInit }}
        />
        <Providers>
          <WebVitals />
          {/* Above the shell on purpose: a viewer must see that the figures
              are a fixture before they read any of them. */}
          <SourceBanner />
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
