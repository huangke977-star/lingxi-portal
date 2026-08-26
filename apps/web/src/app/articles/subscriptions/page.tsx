"use client";

import { Bell, BellOff, BookOpen, CheckCheck, FolderOpen, Rss, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { AppToast } from "@/components/app-toast";
import { DiscoveryArticleRow } from "@/components/discovery-ui";
import { useLanguage } from "@/components/language-provider";
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
  type SubscriptionSettings,
} from "@/lib/discovery-api";
import { localizedPath } from "@/lib/i18n";
import { updateNotificationChannelSettings } from "@/lib/social-api";

type FeedSort = "latest" | "unread" | "popular";
const emptyFeed: SubscriptionFeed = { items: [], total: 0, unread: 0, page: 1, pageSize: 12, totalPages: 1 };
const emptyContentSubscriptions: ContentSubscriptions = { topics: [], collections: [] };
const emptySettings: SubscriptionSettings = { items: [], digestEnabled: true };

export default function SubscriptionFeedPage() {
  return <Suspense fallback={<section className="page-shell"><div className="article-empty-state">Loading subscription updates.</div></section>}><SubscriptionFeedContent /></Suspense>;
}

function SubscriptionFeedContent() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const searchParams = useSearchParams();
  const rawSort = searchParams.get("sort");
  const sort: FeedSort = rawSort === "unread" || rawSort === "popular" ? rawSort : "latest";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [feed, setFeed] = useState<SubscriptionFeed>(emptyFeed);
  const [settings, setSettings] = useState<SubscriptionSettings>(emptySettings);
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
    setSettings(currentSettings);
    setContentSubscriptions(currentContentSubscriptions);
  }, [sort]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) { router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/articles/subscriptions", locale))}`); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    load(token).catch((loadError) => {
      if (isAuthExpiredError(loadError)) { clearAuthTokens(); router.replace(localizedPath("/", locale)); return; }
      setError(loadError instanceof Error ? loadError.message : phrase("订阅动态加载失败。", "Could not load subscription updates."));
    }).finally(() => setIsLoading(false));
  }, [load, locale, phrase, router]);

  const loadMore = useCallback(() => {
    const token = readAccessToken();
    if (!token || isLoadingMore || feed.page >= feed.totalPages) return;
    setIsLoadingMore(true);
    listSubscriptionFeed(token, { page: feed.page + 1, pageSize: 12, sort })
      .then((next) => setFeed((current) => ({ ...next, items: [...current.items, ...next.items.filter((item) => !current.items.some((existing) => existing.article.id === item.article.id))] })))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : phrase("更多订阅动态加载失败。", "Could not load more subscription updates.")))
      .finally(() => setIsLoadingMore(false));
  }, [feed.page, feed.totalPages, isLoadingMore, phrase, sort]);

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
      setNotice(phrase("订阅动态已全部标记为已读。", "All subscription updates are marked as read."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("全部已读操作失败。", "Could not mark all updates as read."));
    }
  }

  async function toggleAuthor(authorId: number, enabled: boolean) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await updateSubscriptionSetting(token, authorId, enabled);
      setSettings((current) => ({ ...current, items: current.items.map((item) => item.author.id === authorId ? { ...item, notifyNewArticles: enabled } : item) }));
      setNotice(enabled ? phrase("已恢复该作者的新内容推送。", "New-content notifications were enabled for this author.") : phrase("已关闭该作者的新内容推送。", "New-content notifications were disabled for this author."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("推送设置更新失败。", "Could not update notification settings."));
    }
  }

  async function toggleDigest(enabled: boolean) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await updateNotificationChannelSettings(token, "subscription", { digestEnabled: enabled });
      setSettings((current) => ({ ...current, digestEnabled: enabled }));
      setNotice(enabled ? phrase("已开启订阅日报。", "Subscription digest enabled.") : phrase("已关闭订阅日报。", "Subscription digest disabled."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("订阅日报设置更新失败。", "Could not update the subscription digest."));
    }
  }

  async function removeTopicSubscription(topicId: number) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await unsubscribeTopic(token, topicId);
      setContentSubscriptions((current) => ({ ...current, topics: current.topics.filter((item) => item.id !== topicId) }));
      setNotice(phrase("已取消专题订阅。", "Topic unsubscribed."));
      await load(token);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("取消专题订阅失败。", "Could not unsubscribe from the topic."));
    }
  }

  async function removeCollectionSubscription(collectionId: number) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await unsubscribeCollection(token, collectionId);
      setContentSubscriptions((current) => ({ ...current, collections: current.collections.filter((item) => item.id !== collectionId) }));
      setNotice(phrase("已取消合集订阅。", "Collection unsubscribed."));
      await load(token);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("取消合集订阅失败。", "Could not unsubscribe from the collection."));
    }
  }

  return <section className="page-shell subscription-feed-page">
    <ArticleCenterNav active="subscriptions" isLoggedIn user={user} />
    <div className="discovery-toolbar">
      <nav aria-label={phrase("订阅动态排序", "Subscription update sort")} className="discovery-sort-tabs article-center-secondary-tabs">
        {(["latest", "unread", "popular"] as FeedSort[]).map((value) => <button className={sort === value ? "active" : undefined} key={value} onClick={() => router.replace(value === "latest" ? localizedPath("/articles/subscriptions", locale) : `${localizedPath("/articles/subscriptions", locale)}?sort=${value}`)} type="button">{value === "latest" ? phrase("最新", "Latest") : value === "unread" ? phrase(`未读 ${feed.unread}`, `Unread ${feed.unread}`) : phrase("热度", "Popular")}</button>)}
      </nav>
      <span className="discovery-toolbar-actions">
        <button aria-label={phrase("订阅管理", "Manage subscriptions")} className={settingsOpen ? "active" : undefined} onClick={() => setSettingsOpen((current) => !current)} title={phrase("订阅管理", "Manage subscriptions")} type="button"><SlidersHorizontal aria-hidden="true" size={17} /></button>
        <button aria-label={phrase("全部已读", "Mark all as read")} disabled={!feed.unread} onClick={() => void markAll()} title={phrase("全部已读", "Mark all as read")} type="button"><CheckCheck aria-hidden="true" size={18} /></button>
      </span>
    </div>
    {settingsOpen ? <section className="subscription-settings-panel subscription-management-panel"><header><strong>{phrase("订阅管理", "Manage subscriptions")}</strong><span>{phrase("作者通知、专题和合集集中管理。", "Manage author notifications, topics, and collections here.")}</span></header><div className="subscription-digest-setting"><span><strong>{phrase("订阅日报", "Subscription digest")}</strong><small>{phrase("将订阅动态汇总为日报通知。", "Receive subscription updates in a daily digest.")}</small></span><button aria-label={settings.digestEnabled ? phrase("关闭订阅日报", "Disable subscription digest") : phrase("开启订阅日报", "Enable subscription digest")} aria-pressed={settings.digestEnabled} className={settings.digestEnabled ? "active" : undefined} onClick={() => void toggleDigest(!settings.digestEnabled)} title={settings.digestEnabled ? phrase("关闭订阅日报", "Disable subscription digest") : phrase("开启订阅日报", "Enable subscription digest")} type="button">{settings.digestEnabled ? <Bell aria-hidden="true" size={16} /> : <BellOff aria-hidden="true" size={16} />}</button></div><div className="subscription-management-groups"><section><h3><Bell aria-hidden="true" size={14} />{phrase("作者推送", "Author notifications")}</h3><div>{settings.items.map((item) => <div className="subscription-author-setting" key={item.author.id}><span>{item.author.nickname}<small>@{item.author.username}</small></span><button aria-label={phrase(`${item.notifyNewArticles ? "关闭" : "开启"}${item.author.nickname}的新内容推送`, `${item.notifyNewArticles ? "Disable" : "Enable"} new-content notifications for ${item.author.nickname}`)} aria-pressed={item.notifyNewArticles} className={item.notifyNewArticles ? "active" : undefined} onClick={() => void toggleAuthor(item.author.id, !item.notifyNewArticles)} title={item.notifyNewArticles ? phrase("关闭推送", "Disable notifications") : phrase("开启推送", "Enable notifications")} type="button">{item.notifyNewArticles ? <Bell aria-hidden="true" size={16} /> : <BellOff aria-hidden="true" size={16} />}</button></div>)}{!settings.items.length ? <p>{phrase("还没有订阅作者。", "No authors are subscribed yet.")}</p> : null}</div></section><section><h3><BookOpen aria-hidden="true" size={14} />{phrase("专题", "Topics")}</h3><div>{contentSubscriptions.topics.map((topic) => <div className="subscription-content-setting" key={topic.id}><Link href={localizedPath(`/topics/${topic.slug}`, locale)}><strong>{topic.title}</strong><small>{phrase(`${topic.articleCount} 篇 · ${topic.subscriberCount} 人订阅`, `${topic.articleCount} articles · ${topic.subscriberCount} subscribers`)}</small></Link><button aria-label={`${phrase("取消订阅", "Unsubscribe")} ${topic.title}`} onClick={() => void removeTopicSubscription(topic.id)} title={phrase("取消订阅", "Unsubscribe")} type="button"><Rss aria-hidden="true" size={16} /></button></div>)}{!contentSubscriptions.topics.length ? <p>{phrase("还没有订阅专题。", "No topics are subscribed yet.")}</p> : null}</div></section><section><h3><FolderOpen aria-hidden="true" size={14} />{phrase("合集", "Collections")}</h3><div>{contentSubscriptions.collections.map((collection) => <div className="subscription-content-setting" key={collection.id}><Link href={localizedPath(`/collections/${collection.id}`, locale)}><strong>{collection.name}</strong><small>{phrase(`${collection.owner.nickname} · ${collection.articleCount} 篇`, `${collection.owner.nickname} · ${collection.articleCount} articles`)}</small></Link><button aria-label={`${phrase("取消订阅", "Unsubscribe")} ${collection.name}`} onClick={() => void removeCollectionSubscription(collection.id)} title={phrase("取消订阅", "Unsubscribe")} type="button"><Rss aria-hidden="true" size={16} /></button></div>)}{!contentSubscriptions.collections.length ? <p>{phrase("还没有订阅合集。", "No collections are subscribed yet.")}</p> : null}</div></section></div></section> : null}
    {isLoading ? <div className="article-empty-state">{phrase("正在读取订阅动态。", "Loading subscription updates.")}</div> : feed.items.length ? <div className="discovery-feed-list">{feed.items.map((item) => <DiscoveryArticleRow article={item.article} key={item.article.id} onOpen={() => void markRead(item.article.id)} unread={!item.readAt} />)}</div> : <div className="article-empty-state"><strong>{phrase("订阅动态还是空的", "No subscription updates yet")}</strong><span>{phrase("订阅作者后，新发布的内容会集中出现在这里。", "New articles from subscribed authors appear here.")}</span></div>}
    {feed.items.length ? <ArticleInfiniteFooter hasMore={feed.page < feed.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
    <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}
