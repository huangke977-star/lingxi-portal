import { Suspense } from "react";
import { ArticleCollectionPage } from "@/components/article-collection-page";

export default function LikedArticlesPage() {
  return <Suspense fallback={<section className="page-shell articles-page"><div className="article-empty-state">正在读取点赞记录。</div></section>}><ArticleCollectionPage mode="liked" /></Suspense>;
}
