import type { Metadata } from "next";
import { ThemeController } from "@/components/theme-controller";
import { TopNav } from "@/components/top-nav";
import "@fontsource-variable/noto-sans-sc/index.css";
import "./misans.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "HLOVET",
  description:
    "HLOVET personal portal, navigation, toolbox, and account workspace",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <ThemeController />
        <TopNav />
        <main className="content-shell">{children}</main>
      </body>
    </html>
  );
}
