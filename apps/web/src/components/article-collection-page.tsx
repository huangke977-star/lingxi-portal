"use client";

import { Bookmark, ChevronLeft, ChevronRight, Heart, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleCard } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import {
  Article,
  ArticleList,
  listFavoriteArticles,
  listLikedArticles,
} from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

type CollectionMode = "favorites" | "liked";

const emptyList: ArticleList = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 12,
  totalPages: 1,
};

export function ArticleCollectionPage({ mode }: { mode: CollectionMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const querySearch = searchParams.get("q") ?? "";
  const queryPage = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const [searchInput, setSearchInput] = useState(querySearch);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [list, setList] = useState<ArticleList>(emptyList);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const composingRef = useRef(false);

  function replaceQuery(next: { q?: string; page?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextSearch = next.q ?? querySearch;
    const nextPage = next.page ?? queryPage;
    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    else params.delete("q");
    if (nextPage > 1) params.set("page", String(nextPage));
    else params.delete("page");
    router.replace(`${mode === "favorites" ? "/articles/favorites" : "/articles/liked"}${params.size ? `?${params}` : ""}`);
  }

  useEffect(() => {
    if (composingRef.current || searchInput === querySearch) return;
    const timer = window.setTimeout(() => replaceQuery({ q: searchInput, page: 1 }), 300);
    return () => window.clearTimeout(timer);
    // Query replacement is intentionally driven by the input value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, querySearch]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(`/login?from=${encodeURIComponent(mode === "favorites" ? "/articles/favorites" : "/articles/liked")}`);
      return;
    }
    // URL changes start a new request cycle for this protected collection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    const request = mode === "favorites" ? listFavoriteArticles : listLikedArticles;
    Promise.all([
      getMe(token),
      request(token, { page: queryPage, pageSize: 12, search: querySearch }),
    ])
      .then(([currentUser, result]) => {
        setUser(currentUser);
        setList(result);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "文章加载失败。");
      })
      .finally(() => setIsLoading(false));
  }, [mode, queryPage, querySearch, router]);

  const isFavorites = mode === "favorites";
  const Icon = isFavorites ? Bookmark : Heart;

  return (
    <section className="page-shell articles-page article-collection-page">
      <header className="page-header articles-header">
        <span className="eyebrow">HLOVET Journal</span>
        <div className="title-row">
          <div>
            <h1>{isFavorites ? "我的收藏" : "赞过的文章"}</h1>
            <p>{isFavorites ? "留住值得再次阅读的内容。" : "回看你曾经表达过认可的文章。"}</p>
          </div>
        </div>
      </header>
      <ArticleCenterNav active={mode} isLoggedIn user={user} />

      <div className="article-feed-toolbar article-collection-toolbar">
        <label className="article-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="搜索文章"
            name="search"
            onChange={(event) => setSearchInput(event.target.value)}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              setSearchInput(event.currentTarget.value);
            }}
            onCompositionStart={() => { composingRef.current = true; }}
            placeholder="搜索标题、正文、标签或作者"
            value={searchInput}
          />
          {searchInput ? (
            <button aria-label="清除搜索" onClick={() => setSearchInput("")} title="清除搜索" type="button">
              <X aria-hidden="true" size={16} />
            </button>
          ) : null}
        </label>
      </div>

      <div className="article-feed-heading">
        <span>{isLoading ? "正在加载" : querySearch ? `找到 ${list.total} 篇` : `${list.total} 篇文章`}</span>
      </div>
      {isLoading ? (
        <div className="article-empty-state">正在读取文章。</div>
      ) : list.items.length ? (
        <div className="article-feed-grid">{list.items.map((article: Article) => <ArticleCard article={article} key={article.id} />)}</div>
      ) : (
        <div className="article-empty-state">
          <Icon aria-hidden="true" size={24} />
          <strong>{querySearch ? "没有匹配的文章" : isFavorites ? "还没有收藏文章" : "还没有点赞文章"}</strong>
          <span>{querySearch ? "试试其他关键词。" : "在文章详情页进行操作后，内容会出现在这里。"}</span>
        </div>
      )}

      {list.totalPages > 1 ? (
        <nav aria-label="分页" className="article-pagination">
          <button disabled={list.page <= 1} onClick={() => replaceQuery({ page: list.page - 1 })} title="上一页" type="button"><ChevronLeft aria-hidden="true" size={18} /></button>
          <span>{list.page} / {list.totalPages}</span>
          <button disabled={list.page >= list.totalPages} onClick={() => replaceQuery({ page: list.page + 1 })} title="下一页" type="button"><ChevronRight aria-hidden="true" size={18} /></button>
        </nav>
      ) : null}
      <AppToast message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}
