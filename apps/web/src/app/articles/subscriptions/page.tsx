"use client";

import { Bell, BellOff, CheckCheck, SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { AppToast } from "@/components/app-toast";
import { DiscoveryArticleRow } from "@/components/discovery-ui";
import { getMe, isAuthExpiredError, type AuthUser } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  listSubscriptionFeed,
  listSubscriptionSettings,
  markAllSubscriptionFeedRead,
  markSubscriptionFeedRead,
  type SubscriptionFeed,
  updateSubscriptionSetting,
} from "@/lib/discovery-api";

type FeedSort = "latest" | "unread" | "popular";
const emptyFeed: SubscriptionFeed = { items: [], total: 0, unread: 0, page: 1, pageSize: 12, totalPages: 1 };

export default function SubscriptionFeedPage() {
  return <Suspense fallback={<section className="page-shell"><div className="article-empty-state">正在读取订阅动态。</div></section>}><SubscriptionFeedContent /></Suspense>;
}

function SubscriptionFeedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawSort = searchParams.get("sort");
  const sort: FeedSort = rawSort === "unread" || rawSort === "popular" ? rawSort : "latest";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [feed, setFeed] = useState<SubscriptionFeed>(emptyFeed);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof listSubscriptionSettings>>["items"]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (token: string) => {
    const [currentUser, currentFeed, currentSettings] = await Promise.all([
      getMe(token),
      listSubscriptionFeed(token, { page: 1, pageSize: 12, sort }),
      listSubscriptionSettings(token),
    ]);
    setUser(currentUser);
    setFeed(currentFeed);
    setSettings(currentSettings.items);
  }, [sort]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) { router.replace("/login?from=%2Farticles%2Fsubscriptions"); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    load(token).catch((loadError) => {
      if (isAuthExpiredError(loadError)) { clearAuthTokens(); router.replace("/"); return; }
      setError(loadError instanceof Error ? loadError.message : "订阅动态加载失败。");
    }).finally(() => setIsLoading(false));
  }, [load, router]);

  const loadMore = useCallback(() => {
    const token = readAccessToken();
    if (!token || isLoadingMore || feed.page >= feed.totalPages) return;
    setIsLoadingMore(true);
    listSubscriptionFeed(token, { page: feed.page + 1, pageSize: 12, sort })
      .then((next) => setFeed((current) => ({ ...next, items: [...current.items, ...next.items.filter((item) => !current.items.some((existing) => existing.article.id === item.article.id))] })))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "更多订阅动态加载失败。"))
      .finally(() => setIsLoadingMore(false));
  }, [feed.page, feed.totalPages, isLoadingMore, sort]);

  async function markRead(articleId: number) {
    const token = readAccessToken();
    const item = feed.items.find((candidate) => candidate.article.id === articleId);
    if (!token || item?.readAt) return;
    try {
      const result = await markSubscriptionFeedRead(token, articleId);
      setFeed((current) => ({ ...current, unread: Math.max(0, current.unread - 1), items: current.items.map((candidate) => candidate.article.id === articleId ? { ...candidate, readAt: result.readAt } : candidate) }));
    } catch {
      // Opening the article remains available even if the supplementary read marker fails.
    }
  }

  async function markAll() {
    const token = readAccessToken();
    if (!token) return;
    try {
      const result = await markAllSubscriptionFeedRead(token);
      setFeed((current) => ({ ...current, unread: 0, items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? result.readAt })) }));
      setNotice("订阅动态已全部标记为已读。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "全部已读操作失败。");
    }
  }

  async function toggleAuthor(authorId: number, enabled: boolean) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await updateSubscriptionSetting(token, authorId, enabled);
      setSettings((current) => current.map((item) => item.author.id === authorId ? { ...item, notifyNewArticles: enabled } : item));
      setNotice(enabled ? "已恢复该作者的新内容推送。" : "已关闭该作者的新内容推送。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "推送设置更新失败。");
    }
  }

  return <section className="page-shell subscription-feed-page">
    <ArticleCenterNav active="subscriptions" isLoggedIn user={user} />
    <div className="discovery-toolbar">
      <nav aria-label="订阅动态排序" className="discovery-sort-tabs">
        {(["latest", "unread", "popular"] as FeedSort[]).map((value) => <button className={sort === value ? "active" : undefined} key={value} onClick={() => router.replace(value === "latest" ? "/articles/subscriptions" : `/articles/subscriptions?sort=${value}`)} type="button">{value === "latest" ? "最新" : value === "unread" ? `未读 ${feed.unread}` : "热度"}</button>)}
      </nav>
      <span className="discovery-toolbar-actions">
        <button aria-label="作者推送设置" className={settingsOpen ? "active" : undefined} onClick={() => setSettingsOpen((current) => !current)} title="作者推送设置" type="button"><SlidersHorizontal aria-hidden="true" size={17} /></button>
        <button aria-label="全部已读" disabled={!feed.unread} onClick={() => void markAll()} title="全部已读" type="button"><CheckCheck aria-hidden="true" size={18} /></button>
      </span>
    </div>
    {settingsOpen ? <section className="subscription-settings-panel"><header><strong>作者推送</strong><span>关闭后仍保留订阅动态，只停止新内容通知。</span></header><div>{settings.map((item) => <label key={item.author.id}><span>{item.author.nickname}<small>@{item.author.username}</small></span><input checked={item.notifyNewArticles} onChange={(event) => void toggleAuthor(item.author.id, event.target.checked)} type="checkbox" /><i>{item.notifyNewArticles ? <Bell aria-hidden="true" size={15} /> : <BellOff aria-hidden="true" size={15} />}</i></label>)}</div>{!settings.length ? <p>还没有订阅作者。</p> : null}</section> : null}
    {isLoading ? <div className="article-empty-state">正在读取订阅动态。</div> : feed.items.length ? <div className="discovery-feed-list">{feed.items.map((item) => <DiscoveryArticleRow article={item.article} key={item.article.id} onOpen={() => void markRead(item.article.id)} unread={!item.readAt} />)}</div> : <div className="article-empty-state"><strong>订阅动态还是空的</strong><span>订阅作者后，新发布的内容会集中出现在这里。</span></div>}
    {feed.items.length ? <ArticleInfiniteFooter hasMore={feed.page < feed.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
    <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}
