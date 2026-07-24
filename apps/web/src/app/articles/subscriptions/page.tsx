import { Suspense } from "react";
import { ArticleCollectionPage } from "@/components/article-collection-page";

export default function SubscribedArticlesPage() {
  return <Suspense><ArticleCollectionPage mode="subscriptions" /></Suspense>;
}
