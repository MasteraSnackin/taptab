import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TapTabPwaBridge } from "./TapTabPwaBridge";
import { resolveTapTabMetadataOrigin } from "./taptab-site-origin";
import { TapTabWalletProvider } from "./wallet/TapTabWalletProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#5f4cf6",
};

export async function generateMetadata(): Promise<Metadata> {
  const origin = resolveTapTabMetadataOrigin(process.env.NEXT_PUBLIC_SITE_URL);

  return {
    metadataBase: new URL(origin),
    applicationName: "TapTab",
    title: "TapTab — Nobody fronts the bill",
    description:
      "Open a group bill, claim your items and settle together on Monad without one person fronting the money.",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "TapTab",
    },
    formatDetection: {
      telephone: false,
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "TapTab — Nobody fronts the bill",
      description: "Claim, approve and pay together on Monad Testnet.",
      type: "website",
      images: [
        {
          url: `${origin}/og.png`,
          width: 1200,
          height: 630,
          alt: "TapTab — nobody fronts the bill",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "TapTab — Nobody fronts the bill",
      description: "Claim, approve and pay together on Monad Testnet.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <TapTabWalletProvider>
          <TapTabPwaBridge>{children}</TapTabPwaBridge>
        </TapTabWalletProvider>
      </body>
    </html>
  );
}
