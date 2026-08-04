import { Suspense } from "react";
import { ArticleCollectionPage, ReadingMode } from "@/components/article-collection-page";

export default async function ReadingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const mode = normalizeMode(params.tab);
  return <Suspense><ArticleCollectionPage mode={mode} /></Suspense>;
}

function normalizeMode(value?: string): ReadingMode {
  return value === "history" || value === "favorites" || value === "liked" ? value : "read-later";
}
