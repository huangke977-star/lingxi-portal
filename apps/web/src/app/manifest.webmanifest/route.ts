const API_BASE_URL =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:3001";

interface PublicSiteSettingsSnapshot {
  siteName?: string;
  browserTitle?: string;
  pwaIconPath?: string;
  updatedAt?: string;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const settings = await readPublicSettings();
  const name = settings.siteName?.trim() || "HLOVET";
  const iconPath = versionedAssetPath(normalizeConfiguredIconPath(settings.pwaIconPath?.trim() || "/pwa-logo.png"), settings.updatedAt);
  const iconType = getIconMimeType(iconPath);
  const isEnglish = request.headers.get("x-lingxi-locale") === "en-US";
  const startUrl = isEnglish ? "/en" : "/";

  return Response.json({
    id: "/",
    name,
    short_name: name.slice(0, 12),
    description: isEnglish
      ? `${name} personal portal, navigation, toolbox, articles, and chat workspace.`
      : `${name} 个人门户、导航、工具、文章与聊天工作台。`,
    lang: isEnglish ? "en-US" : "zh-CN",
    start_url: startUrl,
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    orientation: "any",
    categories: ["productivity", "social", "utilities"],
    icons: [
      {
        src: iconPath,
        sizes: "192x192",
        ...(iconType ? { type: iconType } : {}),
        purpose: "any maskable",
      },
      {
        src: iconPath,
        sizes: "512x512",
        ...(iconType ? { type: iconType } : {}),
        purpose: "any maskable",
      },
    ],
    shortcuts: [
      {
        name: isEnglish ? "Discover" : "发现",
        short_name: isEnglish ? "Discover" : "发现",
        url: isEnglish ? "/en/articles" : "/articles",
        icons: [{ src: iconPath, sizes: "192x192", ...(iconType ? { type: iconType } : {}) }],
      },
      {
        name: isEnglish ? "Navigation" : "导航",
        short_name: isEnglish ? "Navigation" : "导航",
        url: isEnglish ? "/en/nav" : "/nav",
        icons: [{ src: iconPath, sizes: "192x192", ...(iconType ? { type: iconType } : {}) }],
      },
    ],
    theme_color: "#eef8ff",
    background_color: "#eef8ff",
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

function versionedAssetPath(path: string, updatedAt?: string): string {
  if (!updatedAt) return path;
  return `${path}${path.includes("?") ? "&" : "?"}v=${encodeURIComponent(updatedAt)}`;
}

function normalizeConfiguredIconPath(path: string): string {
  return path.startsWith("/site-settings/") ? `/api${path}` : path;
}

function getIconMimeType(path: string): string | null {
  const extension = path.split("?")[0].split("#")[0].toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return null;
}

async function readPublicSettings(): Promise<PublicSiteSettingsSnapshot> {
  try {
    const response = await fetch(`${API_BASE_URL}/site-settings/public`, {
      cache: "no-store",
    });
    return response.ok ? ((await response.json()) as PublicSiteSettingsSnapshot) : {};
  } catch {
    return {};
  }
}
