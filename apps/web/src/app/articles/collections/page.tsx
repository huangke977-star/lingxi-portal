"use client";

import Link from "next/link";
import {
  ExternalLink,
  FolderOpen,
  FolderPlus,
  Plus,
  Rss,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { AppToast } from "@/components/app-toast";
import { ContentArticleManager } from "@/components/content-article-manager";
import { formatArticleDate } from "@/components/article-ui";
import { listMyArticles, type Article } from "@/lib/article-api";
import { getMe, isAuthExpiredError, resolveApiUrl, type AuthUser } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  addCollectionArticle,
  createCollection,
  deleteCollection,
  listMyCollections,
  listVisibleCollections,
  removeCollectionArticle,
  reorderCollectionArticles,
  subscribeCollection,
  type ArticleCollection,
  unsubscribeCollection,
  updateCollection,
} from "@/lib/discovery-api";

type CollectionView = "mine" | "browse";
type CollectionPage = Awaited<ReturnType<typeof listVisibleCollections>>;
const emptyBrowse: CollectionPage = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 12,
  totalPages: 1,
};

export default function ArticleCollectionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [view, setView] = useState<CollectionView>("browse");
  const [collections, setCollections] = useState<ArticleCollection[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] =
    useState<ArticleCollection["visibility"]>("public");
  const [newName, setNewName] = useState("");
  const [browseQuery, setBrowseQuery] = useState("");
  const [browse, setBrowse] = useState<CollectionPage>(emptyBrowse);
  const [isLoading, setIsLoading] = useState(true);
  const [isBrowseLoading, setIsBrowseLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [browseActionId, setBrowseActionId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = collections.find((item) => item.id === selectedId) ?? null;

  function selectCollection(next: ArticleCollection | null) {
    setSelectedId(next?.id ?? null);
    setName(next?.name ?? "");
    setDescription(next?.description ?? "");
    setVisibility(next?.visibility ?? "public");
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login?from=%2Farticles%2Fcollections");
      return;
    }
    Promise.all([
      getMe(token),
      listMyCollections(token),
      loadAllMyPublishedArticles(token),
    ])
      .then(([currentUser, collectionResult, articleResult]) => {
        const first = collectionResult.items[0] ?? null;
        setUser(currentUser);
        setCollections(collectionResult.items);
        setArticles(articleResult);
        selectCollection(first);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : "合集加载失败。",
        );
      })
      .finally(() => setIsLoading(false));
  }, [router]);

  useEffect(() => {
    if (view !== "browse") return;
    const token = readAccessToken();
    if (!token) return;
    const timer = window.setTimeout(() => {
      setIsBrowseLoading(true);
      listVisibleCollections(token, {
        q: browseQuery.trim(),
        page: 1,
        pageSize: 12,
      })
        .then(setBrowse)
        .catch((loadError) =>
          setError(
            loadError instanceof Error
              ? loadError.message
              : "可见合集加载失败。",
          ),
        )
        .finally(() => setIsBrowseLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [browseQuery, view]);

  const loadMore = useCallback(() => {
    const token = readAccessToken();
    if (!token || isLoadingMore || browse.page >= browse.totalPages) return;
    setIsLoadingMore(true);
    listVisibleCollections(token, {
      q: browseQuery.trim(),
      page: browse.page + 1,
      pageSize: 12,
    })
      .then((next) =>
        setBrowse((current) => ({
          ...next,
          items: [
            ...current.items,
            ...next.items.filter(
              (item) =>
                !current.items.some((existing) => existing.id === item.id),
            ),
          ],
        })),
      )
      .catch((loadError) =>
        setError(
          loadError instanceof Error ? loadError.message : "更多合集加载失败。",
        ),
      )
      .finally(() => setIsLoadingMore(false));
  }, [browse.page, browse.totalPages, browseQuery, isLoadingMore]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token || !newName.trim()) return;
    setIsSaving(true);
    try {
      const created = await createCollection(token, { name: newName.trim() });
      setCollections((current) => [...current, created]);
      selectCollection(created);
      setNewName("");
      setNotice("合集已创建。");
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "合集创建失败。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function save() {
    const token = readAccessToken();
    if (!token || !selected) return;
    setIsSaving(true);
    try {
      replaceCollection(
        await updateCollection(token, selected.id, {
          name: name.trim(),
          description: description.trim(),
          visibility,
        }),
      );
      setNotice("合集设置已保存。");
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "合集保存失败。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function removeCollection() {
    const token = readAccessToken();
    if (
      !token ||
      !selected ||
      !window.confirm(`删除合集“${selected.name}”吗？文章本身不会删除。`)
    )
      return;
    try {
      await deleteCollection(token, selected.id);
      const remaining = collections.filter((item) => item.id !== selected.id);
      setCollections(remaining);
      selectCollection(remaining[0] ?? null);
      setNotice("合集已删除，文章内容未受影响。");
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "合集删除失败。",
      );
    }
  }

  async function toggleArticle(articleId: number, included: boolean) {
    const token = readAccessToken();
    if (!token || !selected) return;
    try {
      replaceCollection(
        included
          ? await removeCollectionArticle(token, selected.id, articleId)
          : await addCollectionArticle(token, selected.id, articleId),
      );
      setNotice(included ? "文章已移出合集。" : "文章已加入合集。");
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "合集文章更新失败。",
      );
    }
  }

  async function reorderArticles(ids: number[]) {
    const token = readAccessToken();
    if (!token || !selected) return;
    const previous = selected;
    const articleById = new Map(
      selected.articles.map((article) => [article.id, article]),
    );
    replaceCollection({
      ...selected,
      articles: ids.flatMap((id) => articleById.get(id) ?? []),
      articleCount: ids.length,
    });
    try {
      replaceCollection(
        await reorderCollectionArticles(token, selected.id, ids),
      );
    } catch (actionError) {
      replaceCollection(previous);
      setError(
        actionError instanceof Error ? actionError.message : "合集排序失败。",
      );
    }
  }

  function replaceCollection(next: ArticleCollection) {
    setCollections((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
  }

  async function toggleBrowseSubscription(collection: ArticleCollection) {
    const token = readAccessToken();
    if (!token || collection.owner.id === user?.id) return;
    setBrowseActionId(collection.id);
    try {
      const result = collection.subscribed ? await unsubscribeCollection(token, collection.id) : await subscribeCollection(token, collection.id);
      setBrowse((current) => ({
        ...current,
        items: current.items.map((item) => item.id === collection.id ? { ...item, subscribed: result.subscribed, subscriberCount: result.subscriberCount } : item),
      }));
      setNotice(result.subscribed ? "已订阅合集。" : "已取消合集订阅。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "合集订阅操作失败。");
    } finally {
      setBrowseActionId(null);
    }
  }

  return (
    <section className="page-shell collection-manager-page">
      <ArticleCenterNav active="collections" isLoggedIn user={user} />
      <nav aria-label="合集页面" className="collection-page-tabs article-center-secondary-tabs">
        <button
          className={view === "browse" ? "active" : undefined}
          onClick={() => setView("browse")}
          type="button"
        >
          浏览合集
        </button>
        <button
          className={view === "mine" ? "active" : undefined}
          onClick={() => setView("mine")}
          type="button"
        >
          我的合集
        </button>
      </nav>

      {view === "browse" ? (
        <BrowseCollections
          browse={browse}
          isLoading={isBrowseLoading}
          actingId={browseActionId}
          currentUserId={user?.id ?? null}
          onToggle={toggleBrowseSubscription}
          query={browseQuery}
          setQuery={setBrowseQuery}
        />
      ) : (
        <>
          <form className="collection-create-bar" onSubmit={create}>
            <FolderPlus aria-hidden="true" size={18} />
            <input
              aria-label="新合集名称"
              maxLength={80}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="新合集名称"
              value={newName}
            />
            <button disabled={isSaving || !newName.trim()} type="submit">
              <Plus aria-hidden="true" size={16} />
              创建
            </button>
          </form>
          {isLoading ? (
            <div className="article-empty-state">正在读取合集。</div>
          ) : (
            <div className="collection-manager-layout">
              <aside className="collection-manager-list">
                {collections.map((collection) => (
                  <button
                    className={
                      collection.id === selectedId ? "active" : undefined
                    }
                    key={collection.id}
                    onClick={() => selectCollection(collection)}
                    type="button"
                  >
                    <span>
                      <strong>{collection.name}</strong>
                      <small>{collection.articleCount} 篇文章</small>
                    </span>
                    <em>
                      {collection.visibility === "public"
                        ? "公开"
                        : collection.visibility === "authenticated"
                          ? "登录可见"
                          : "仅自己"}
                    </em>
                  </button>
                ))}
                {!collections.length ? (
                  <div className="article-empty-inline">先创建一个合集。</div>
                ) : null}
              </aside>
              <section className="collection-inspector">
                {selected ? (
                  <>
                    <header>
                      <div>
                        <strong>{selected.name}</strong>
                        <span>
                          更新于 {formatArticleDate(selected.updatedAt)}
                        </span>
                      </div>
                      <span className="inspector-header-actions">
                        <Link href={`/collections/${selected.id}`}>
                          <ExternalLink aria-hidden="true" size={15} />
                          查看
                        </Link>
                        <button
                          disabled={isSaving || !name.trim()}
                          onClick={() => void save()}
                          type="button"
                        >
                          <Save aria-hidden="true" size={15} />
                          保存
                        </button>
                        <button
                          className="danger"
                          onClick={() => void removeCollection()}
                          type="button"
                        >
                          <Trash2 aria-hidden="true" size={15} />
                          删除
                        </button>
                      </span>
                    </header>
                    <div className="collection-form-grid">
                      <label>
                        <span>合集名称</span>
                        <input
                          maxLength={80}
                          onChange={(event) => setName(event.target.value)}
                          value={name}
                        />
                      </label>
                      <label>
                        <span>可见范围</span>
                        <select
                          onChange={(event) =>
                            setVisibility(
                              event.target
                                .value as ArticleCollection["visibility"],
                            )
                          }
                          value={visibility}
                        >
                          <option value="public">公开</option>
                          <option value="authenticated">登录可见</option>
                          <option value="private">仅自己</option>
                        </select>
                      </label>
                      <label className="wide">
                        <span>合集说明</span>
                        <textarea
                          maxLength={300}
                          onChange={(event) =>
                            setDescription(event.target.value)
                          }
                          rows={2}
                          value={description}
                        />
                      </label>
                    </div>
                    <ContentArticleManager
                      articles={articles}
                      noun="合集"
                      onReorder={reorderArticles}
                      onToggle={toggleArticle}
                      selectedArticles={selected.articles}
                    />
                  </>
                ) : (
                  <div className="article-empty-state">
                    选择或创建一个合集。
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
      {view === "browse" && browse.items.length ? (
        <ArticleInfiniteFooter
          hasMore={browse.page < browse.totalPages}
          isLoading={isLoadingMore}
          onLoadMore={loadMore}
        />
      ) : null}
      <AppToast
        message={error || notice}
        onDismiss={() => {
          setError("");
          setNotice("");
        }}
        tone={error ? "error" : "success"}
      />
    </section>
  );
}

function BrowseCollections({
  actingId,
  browse,
  currentUserId,
  isLoading,
  onToggle,
  query,
  setQuery,
}: {
  actingId: number | null;
  browse: CollectionPage;
  currentUserId: number | null;
  isLoading: boolean;
  onToggle: (collection: ArticleCollection) => void;
  query: string;
  setQuery: (value: string) => void;
}) {
  return (
    <section className="collection-browse">
      <label className="collection-browse-search">
        <Search aria-hidden="true" size={16} />
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索合集、说明、昵称或用户名"
          value={query}
        />
      </label>
      {isLoading ? (
        <div className="article-empty-state">正在搜索可见合集。</div>
      ) : browse.items.length ? (
        <div className="collection-browse-grid">
          {browse.items.map((collection) => (
            <article className="collection-browse-card" key={collection.id}>
              <Link href={`/collections/${collection.id}`}>
                <span className="collection-browse-cover">
                  {collection.articles[0]?.coverPath ? <img alt="" src={resolveApiUrl(collection.articles[0].coverPath)} /> : <FolderOpen aria-hidden="true" size={34} />}
                  <small>{collection.articleCount} 篇</small>
                </span>
                <span className="collection-browse-copy">
                  <strong>{collection.name}</strong>
                  <small>{collection.description || "这个合集暂时没有说明。"}</small>
                  <em>{collection.owner.nickname}</em>
                </span>
              </Link>
              <footer><span>{collection.subscriberCount} 人订阅</span>{collection.owner.id !== currentUserId ? <button aria-label={collection.subscribed ? `取消订阅 ${collection.name}` : `订阅 ${collection.name}`} className={collection.subscribed ? "active" : undefined} disabled={actingId === collection.id} onClick={() => onToggle(collection)} title={collection.subscribed ? "取消订阅" : "订阅"} type="button"><Rss aria-hidden="true" size={15} /></button> : <em>我的合集</em>}</footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="article-empty-state">没有找到当前账号可见的合集。</div>
      )}
    </section>
  );
}

async function loadAllMyPublishedArticles(token: string): Promise<Article[]> {
  const first = await listMyArticles(token, {
    page: 1,
    pageSize: 50,
    status: "published",
    sort: "latest",
  });
  if (first.totalPages <= 1) return first.items;
  const rest = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, index) =>
      listMyArticles(token, {
        page: index + 2,
        pageSize: 50,
        status: "published",
        sort: "latest",
      }),
    ),
  );
  return [first, ...rest].flatMap((page) => page.items);
}
