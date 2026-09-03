import type { MetadataRoute } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://5200918.xyz").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/profile/", "/messages/", "/articles/mine/", "/articles/reading/", "/articles/subscriptions/", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
