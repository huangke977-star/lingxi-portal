const API_BASE_URL =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:3001";

interface PublicSiteSettingsSnapshot {
  siteName?: string;
  browserTitle?: string;
  pwaIconPath?: string;
}

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await readPublicSettings();
  const name = settings.siteName?.trim() || "HLOVET";
  const iconPath = settings.pwaIconPath?.trim() || "/icon-192.png";

  return Response.json({
    id: "/",
    name,
    short_name: name.slice(0, 12),
    description: `${name} personal portal, navigation, toolbox, articles, and chat workspace.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    orientation: "any",
    categories: ["productivity", "social", "utilities"],
    icons: [
      {
        src: iconPath,
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: iconPath,
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
    shortcuts: [
      {
        name: "发现",
        short_name: "发现",
        url: "/articles",
        icons: [{ src: iconPath, sizes: "192x192", type: "image/png" }],
      },
      {
        name: "导航",
        short_name: "导航",
        url: "/nav",
        icons: [{ src: iconPath, sizes: "192x192", type: "image/png" }],
      },
    ],
    theme_color: "#eef8ff",
    background_color: "#eef8ff",
  });
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
