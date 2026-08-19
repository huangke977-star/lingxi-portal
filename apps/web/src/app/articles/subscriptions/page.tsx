"use client";

import { Bell, BellOff, BookOpen, CheckCheck, FolderOpen, Rss, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
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
  listContentSubscriptions,
  listSubscriptionSettings,
  markAllSubscriptionFeedRead,
  markSubscriptionFeedRead,
  type SubscriptionFeed,
  type ContentSubscriptions,
  unsubscribeCollection,
  unsubscribeTopic,
  updateSubscriptionSetting,
} from "@/lib/discovery-api";

type FeedSort = "latest" | "unread" | "popular";
const emptyFeed: SubscriptionFeed = { items: [], total: 0, unread: 0, page: 1, pageSize: 12, totalPages: 1 };
const emptyContentSubscriptions: ContentSubscriptions = { topics: [], collections: [] };

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
  const [contentSubscriptions, setContentSubscriptions] = useState<ContentSubscriptions>(emptyContentSubscriptions);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (token: string) => {
    const [currentUser, currentFeed, currentSettings, currentContentSubscriptions] = await Promise.all([
      getMe(token),
      listSubscriptionFeed(token, { page: 1, pageSize: 12, sort }),
      listSubscriptionSettings(token),
      listContentSubscriptions(token),
    ]);
    setUser(currentUser);
    setFeed(currentFeed);
    setSettings(currentSettings.items);
    setContentSubscriptions(currentContentSubscriptions);
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

  async function removeTopicSubscription(topicId: number) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await unsubscribeTopic(token, topicId);
      setContentSubscriptions((current) => ({ ...current, topics: current.topics.filter((item) => item.id !== topicId) }));
      setNotice("已取消专题订阅。");
      await load(token);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "取消专题订阅失败。");
    }
  }

  async function removeCollectionSubscription(collectionId: number) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await unsubscribeCollection(token, collectionId);
      setContentSubscriptions((current) => ({ ...current, collections: current.collections.filter((item) => item.id !== collectionId) }));
      setNotice("已取消合集订阅。");
      await load(token);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "取消合集订阅失败。");
    }
  }

  return <section className="page-shell subscription-feed-page">
    <ArticleCenterNav active="subscriptions" isLoggedIn user={user} />
    <div className="discovery-toolbar">
      <nav aria-label="订阅动态排序" className="discovery-sort-tabs article-center-secondary-tabs">
        {(["latest", "unread", "popular"] as FeedSort[]).map((value) => <button className={sort === value ? "active" : undefined} key={value} onClick={() => router.replace(value === "latest" ? "/articles/subscriptions" : `/articles/subscriptions?sort=${value}`)} type="button">{value === "latest" ? "最新" : value === "unread" ? `未读 ${feed.unread}` : "热度"}</button>)}
      </nav>
      <span className="discovery-toolbar-actions">
        <button aria-label="订阅管理" className={settingsOpen ? "active" : undefined} onClick={() => setSettingsOpen((current) => !current)} title="订阅管理" type="button"><SlidersHorizontal aria-hidden="true" size={17} /></button>
        <button aria-label="全部已读" disabled={!feed.unread} onClick={() => void markAll()} title="全部已读" type="button"><CheckCheck aria-hidden="true" size={18} /></button>
      </span>
    </div>
    {settingsOpen ? <section className="subscription-settings-panel subscription-management-panel"><header><strong>订阅管理</strong><span>作者通知、专题和合集集中管理。</span></header><div className="subscription-management-groups"><section><h3><Bell aria-hidden="true" size={14} />作者推送</h3><div>{settings.map((item) => <div className="subscription-author-setting" key={item.author.id}><span>{item.author.nickname}<small>@{item.author.username}</small></span><button aria-label={`${item.notifyNewArticles ? "关闭" : "开启"}${item.author.nickname}的新内容推送`} aria-pressed={item.notifyNewArticles} className={item.notifyNewArticles ? "active" : undefined} onClick={() => void toggleAuthor(item.author.id, !item.notifyNewArticles)} title={item.notifyNewArticles ? "关闭推送" : "开启推送"} type="button">{item.notifyNewArticles ? <Bell aria-hidden="true" size={16} /> : <BellOff aria-hidden="true" size={16} />}</button></div>)}{!settings.length ? <p>还没有订阅作者。</p> : null}</div></section><section><h3><BookOpen aria-hidden="true" size={14} />专题</h3><div>{contentSubscriptions.topics.map((topic) => <div className="subscription-content-setting" key={topic.id}><Link href={`/topics/${topic.slug}`}><strong>{topic.title}</strong><small>{topic.articleCount} 篇 · {topic.subscriberCount} 人订阅</small></Link><button aria-label={`取消订阅 ${topic.title}`} onClick={() => void removeTopicSubscription(topic.id)} title="取消订阅" type="button"><Rss aria-hidden="true" size={16} /></button></div>)}{!contentSubscriptions.topics.length ? <p>还没有订阅专题。</p> : null}</div></section><section><h3><FolderOpen aria-hidden="true" size={14} />合集</h3><div>{contentSubscriptions.collections.map((collection) => <div className="subscription-content-setting" key={collection.id}><Link href={`/collections/${collection.id}`}><strong>{collection.name}</strong><small>{collection.owner.nickname} · {collection.articleCount} 篇</small></Link><button aria-label={`取消订阅 ${collection.name}`} onClick={() => void removeCollectionSubscription(collection.id)} title="取消订阅" type="button"><Rss aria-hidden="true" size={16} /></button></div>)}{!contentSubscriptions.collections.length ? <p>还没有订阅合集。</p> : null}</div></section></div></section> : null}
    {isLoading ? <div className="article-empty-state">正在读取订阅动态。</div> : feed.items.length ? <div className="discovery-feed-list">{feed.items.map((item) => <DiscoveryArticleRow article={item.article} key={item.article.id} onOpen={() => void markRead(item.article.id)} unread={!item.readAt} />)}</div> : <div className="article-empty-state"><strong>订阅动态还是空的</strong><span>订阅作者后，新发布的内容会集中出现在这里。</span></div>}
    {feed.items.length ? <ArticleInfiniteFooter hasMore={feed.page < feed.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
    <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}
