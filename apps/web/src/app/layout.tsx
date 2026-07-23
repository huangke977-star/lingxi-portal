import type { Metadata } from "next";
import { AuthSessionController } from "@/components/auth-session-controller";
import { ChatDock } from "@/components/chat-dock";
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
      { url: "/tab-icon.svg?v=2", type: "image/svg+xml" },
      { url: "/favicon.ico?v=2", sizes: "any" },
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
        <AuthSessionController />
        <ThemeController />
        <TopNav />
        <main className="content-shell">{children}</main>
        <ChatDock />
      </body>
    </html>
  );
}
