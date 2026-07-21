import { Suspense } from "react";
import { ArticleCollectionPage } from "@/components/article-collection-page";

export default function FavoriteArticlesPage() {
  return <Suspense fallback={<section className="page-shell articles-page"><div className="article-empty-state">正在读取收藏。</div></section>}><ArticleCollectionPage mode="favorites" /></Suspense>;
}
