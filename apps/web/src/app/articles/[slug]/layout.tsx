import type { Metadata } from "next";
import type { ReactNode } from "react";

const API_BASE_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://5200918.xyz").replace(/\/$/, "");

interface ArticleMetadata {
  title: string;
  slug: string;
  summary: string;
  coverPath: string | null;
  authorName: string;
  authorUsername: string;
  publishedAt: string | null;
  updatedAt: string;
  language: string;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleMetadata(slug);
  if (!article) return { robots: { index: false, follow: false } };

  const canonical = `${SITE_URL}/articles/${encodeURIComponent(article.slug)}`;
  const image = article.coverPath ? absoluteAssetUrl(article.coverPath) : `${SITE_URL}/pwa-logo.png`;
  return {
    title: article.title,
    description: article.summary,
    alternates: { canonical },
    authors: [{ name: article.authorName, url: `${SITE_URL}/users/${encodeURIComponent(article.authorUsername)}` }],
    openGraph: {
      type: "article",
      url: canonical,
      title: article.title,
      description: article.summary,
      siteName: "HLOVET",
      locale: article.language,
      publishedTime: article.publishedAt ?? undefined,
      modifiedTime: article.updatedAt,
      authors: [article.authorName],
      images: [{ url: image, alt: article.title }],
    },
    twitter: { card: "summary_large_image", title: article.title, description: article.summary, images: [image] },
  };
}

export default function ArticleLayout({ children }: { children: ReactNode }) {
  return children;
}

async function getArticleMetadata(slug: string): Promise<ArticleMetadata | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/distribution/articles/${encodeURIComponent(slug)}/metadata`, { cache: "no-store" });
    return response.ok ? await response.json() as ArticleMetadata : null;
  } catch {
    return null;
  }
}

function absoluteAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/api/")) return `${SITE_URL}${path}`;
  if (path.startsWith("/articles/") || path.startsWith("/discovery/") || path.startsWith("/site-settings/")) return `${SITE_URL}/api${path}`;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
