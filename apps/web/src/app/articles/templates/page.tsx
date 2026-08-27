import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleTemplatesPanel } from "@/components/article-templates-panel";

export default function ArticleTemplatesPage() {
  return (
    <section className="page-shell articles-page article-templates-page">
      <ArticleCenterNav active="templates" isLoggedIn />
      <ArticleTemplatesPanel />
    </section>
  );
}
