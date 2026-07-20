"use client";

import Link from "next/link";
import { PenLine, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { ArticleCard } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import {
  Article,
  listPublicArticles,
  listVisibleArticles,
} from "@/lib/article-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { isAuthExpiredError } from "@/lib/auth-api";

export default function ArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("latest");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadArticles(nextSearch = search, nextSort = sort) {
    setIsLoading(true);
    const token = readAccessToken();
    setIsLoggedIn(Boolean(token));
    try {
      const result = token
        ? await listVisibleArticles(token, { search: nextSearch, sort: nextSort, pageSize: 20 })
        : await listPublicArticles({ search: nextSearch, sort: nextSort, pageSize: 20 });
      setArticles(result.items);
      setTotal(result.total);
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        const result = await listPublicArticles({ search: nextSearch, sort: nextSort, pageSize: 20 });
        setArticles(result.items);
        setTotal(result.total);
        setIsLoggedIn(false);
      } else {
        setError(loadError instanceof Error ? loadError.message : "文章加载失败。");
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // The request synchronizes the page with the current auth state and feed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadArticles();
    // The initial request intentionally runs once; filters are submitted explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="page-shell articles-page">
      <header className="page-header articles-header">
        <span className="eyebrow">HLOVET Journal</span>
        <div className="title-row">
          <div>
            <h1>文章</h1>
            <p>记录经验、分享想法，也看看这里正在发生什么。</p>
          </div>
          {isLoggedIn ? <Link className="text-action article-write-link" href="/profile/articles?new=1"><PenLine aria-hidden="true" size={16} />写文章</Link> : null}
        </div>
      </header>

      <div className="article-feed-toolbar">
        <form className="article-search" onSubmit={(event) => { event.preventDefault(); void loadArticles(); }}>
          <Search aria-hidden="true" size={17} />
          <input aria-label="搜索文章" onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、摘要或正文" value={search} />
          <button aria-label="搜索" title="搜索" type="submit">搜索</button>
        </form>
        <div className="article-sort-tabs" role="tablist">
          {[["latest", "最新"], ["popular", "热门"], ["pinned", "置顶"]].map(([value, label]) => (
            <button className={sort === value ? "active" : undefined} key={value} onClick={() => { setSort(value); void loadArticles(search, value); }} role="tab" type="button">{label}</button>
          ))}
        </div>
      </div>

      <div className="article-feed-heading"><span>{isLoading ? "正在加载" : `${total} 篇文章`}</span>{isLoggedIn ? <Link href="/profile/articles">管理我的文章</Link> : <Link href="/login?from=%2Farticles">登录后发布</Link>}</div>
      {isLoading ? <div className="article-empty-state">正在读取文章。</div> : articles.length ? <div className="article-feed-grid">{articles.map((article) => <ArticleCard article={article} key={article.id} />)}</div> : <div className="article-empty-state"><strong>还没有找到文章</strong><span>换一个关键词，或者成为第一个写下内容的人。</span></div>}

      <AppToast message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}
