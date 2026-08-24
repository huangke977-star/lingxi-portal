import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import { AuthSessionController } from "@/components/auth-session-controller";
import { ChatDock } from "@/components/chat-dock";
import { LanguageProvider } from "@/components/language-provider";
import { PwaController } from "@/components/pwa-controller";
import { RouteBackButton } from "@/components/route-back-button";
import { ScrollContainment } from "@/components/scroll-containment";
import { ScrollToTop } from "@/components/scroll-to-top";
import { ThemeController } from "@/components/theme-controller";
import { isLocale, type Locale } from "@/lib/i18n";
import { TopNav } from "@/components/top-nav";
import "@fontsource-variable/noto-sans-sc/index.css";
import "./misans.css";
import "./globals.css";

const API_BASE_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

interface PublicBrandSettings {
  siteName?: string;
  browserTitle?: string;
  pwaIconPath?: string;
  updatedAt?: string;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale();
  const settings = await readPublicBrandSettings();
  const siteName = settings.siteName?.trim() || "HLOVET";
  const browserTitle = settings.browserTitle?.trim() || siteName;
  const iconPath = versionedAssetPath(settings.pwaIconPath?.trim() || "/pwa-logo.png", settings.updatedAt);
  return {
    applicationName: siteName,
    title: browserTitle,
    description: locale === "en-US"
      ? `${siteName} personal portal, navigation, toolbox, and account workspace`
      : `${siteName} 个人门户、导航、工具与账号工作台`,
    manifest: locale === "en-US" ? "/en/manifest.webmanifest" : "/manifest.webmanifest",
    icons: { icon: [{ url: iconPath }], shortcut: [{ url: iconPath }], apple: [{ url: iconPath }] },
    appleWebApp: { capable: true, statusBarStyle: "default", title: siteName },
    other: {
      "mobile-web-app-capable": "yes",
      "apple-mobile-web-app-capable": "yes",
      "apple-mobile-web-app-title": siteName,
      "content-language": locale,
    },
  };
}

async function readPublicBrandSettings(): Promise<PublicBrandSettings> {
  try {
    const response = await fetch(`${API_BASE_URL}/site-settings/public`, { cache: "no-store" });
    return response.ok ? await response.json() as PublicBrandSettings : {};
  } catch {
    return {};
  }
}

function versionedAssetPath(path: string, updatedAt?: string): string {
  if (!updatedAt) return path;
  return `${path}${path.includes("?") ? "&" : "?"}v=${encodeURIComponent(updatedAt)}`;
}

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

  } catch {
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await resolveRequestLocale();
  return (
    <html data-portal-theme="cloud-blue" lang={locale}>
      <body>
        <Script id="hlovet-theme-boot" strategy="beforeInteractive">
          {themeBootScript}
        </Script>
        <LanguageProvider initialLocale={locale}>
          <AuthSessionController />
          <PwaController />
          <ThemeController />
          <ScrollContainment />
          <TopNav />
          <main className="content-shell">
            <RouteBackButton />
            {children}
          </main>
          <ScrollToTop />
          <ChatDock />
        </LanguageProvider>
      </body>
    </html>
  );
}

async function resolveRequestLocale(): Promise<Locale> {
  const requestHeaders = await headers();
  const value = requestHeaders.get("x-lingxi-locale");
  return isLocale(value) ? value : "zh-CN";
}
