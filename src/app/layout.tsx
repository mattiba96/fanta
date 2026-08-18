import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { triggerAutoRefreshIfStale } from "@/lib/scraping/autoRefresh";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fantacucciolo",
  description: "Assistente personale per l'asta del fantacalcio",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  triggerAutoRefreshIfStale();

  return (
    <html
      lang="it"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
