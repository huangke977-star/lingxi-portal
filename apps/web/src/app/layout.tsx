import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { AuthSessionController } from "@/components/auth-session-controller";
import { ChatDock } from "@/components/chat-dock";
import { PwaController } from "@/components/pwa-controller";
import { ThemeController } from "@/components/theme-controller";
import { TopNav } from "@/components/top-nav";
import "@fontsource-variable/noto-sans-sc/index.css";
import "./misans.css";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "HLOVET",
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
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "HLOVET",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "HLOVET",
  },
};

export const viewport: Viewport = {
  initialScale: 1,
  interactiveWidget: "resizes-content",
  themeColor: "#eef8ff",
  viewportFit: "cover",
  width: "device-width",
};

const themeBootScript = String.raw`
(() => {
  try {
    const root = document.documentElement;
    const storedTheme = window.localStorage.getItem("hlovet.theme.preference");
    if (storedTheme) {
      const parsedTheme = JSON.parse(storedTheme);
      const themeId = parsedTheme && typeof parsedTheme.themeId === "string" ? parsedTheme.themeId : "";
      if (["sakura-mist", "cloud-blue", "night-purple", "custom"].includes(themeId)) {
        root.dataset.portalTheme = themeId;
      }
    }

    const cachedBackground = window.localStorage.getItem("hlovet.active-background.url");
    if (!cachedBackground) return;
    const backgroundUrl = new URL(cachedBackground, window.location.origin);
    if (!["http:", "https:"].includes(backgroundUrl.protocol)) return;
    const escapedUrl = backgroundUrl.href.replace(/["\\\n\r\f]/g, "\\$&");
    root.style.setProperty("--portal-bg-image", 'url("' + escapedUrl + '")');
  } catch {
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-portal-theme="cloud-blue" lang="zh-CN">
      <body>
        <Script
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
          id="hlovet-theme-boot"
          strategy="beforeInteractive"
        />
        <AuthSessionController />
        <PwaController />
        <ThemeController />
        <TopNav />
        <main className="content-shell">{children}</main>
        <ChatDock />
      </body>
    </html>
  );
}
