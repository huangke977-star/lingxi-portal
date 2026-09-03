import type { MetadataRoute } from "next";

const API_BASE_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://5200918.xyz").replace(/\/$/, "");

interface SitemapEntry {
  url: string;
  lastModified: string;
}

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const response = await fetch(`${API_BASE_URL}/distribution/sitemap`, { cache: "no-store" });
    if (!response.ok) return fallbackEntries();
    const entries = await response.json() as SitemapEntry[];
    return entries.map((entry) => ({
      url: entry.url.startsWith("http") ? entry.url : `${SITE_URL}${entry.url}`,
      lastModified: entry.lastModified,
      changeFrequency: entry.url.includes("/articles/") ? "weekly" : "daily",
      priority: entry.url === SITE_URL ? 1 : entry.url.includes("/articles/") ? 0.8 : 0.6,
    }));
  } catch {
    return fallbackEntries();
  }
}

function fallbackEntries(): MetadataRoute.Sitemap {
  const now = new Date();
  return ["", "/articles", "/topics", "/articles/collections"].map((path, index) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: index === 0 ? "daily" : "weekly",
    priority: index === 0 ? 1 : 0.7,
  }));
}
