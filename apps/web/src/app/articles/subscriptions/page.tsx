"use client";

import { Bell, BellOff, BookOpen, CheckCheck, FolderOpen, Hash, Mail, Rss, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { AppToast } from "@/components/app-toast";
import { DiscoveryArticleRow } from "@/components/discovery-ui";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { getMe, isAuthExpiredError, type AuthUser } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  listSubscriptionFeed,
  listContentSubscriptions,
  listSubscriptionSettings,
  markAllSubscriptionFeedRead,
  markSubscriptionFeedRead,
  updateTagSubscriptionFrequency,
  updateTopicSubscriptionFrequency,
  unsubscribeTag,
  type SubscriptionFeed,
  type ContentSubscriptions,
  unsubscribeCollection,
  unsubscribeTopic,
  updateSubscriptionSetting,
  type SubscriptionSettings,
} from "@/lib/discovery-api";
import { localizedPath } from "@/lib/i18n";
import { unsubscribeFromAuthor, updateNotificationChannelSettings } from "@/lib/social-api";
import { getSubscriptionEmailSettings, updateSubscriptionEmailSettings, type SubscriptionEmailSettings } from "@/lib/distribution-api";

type FeedSort = "latest" | "unread" | "popular";
type SubscriptionFrequency = "instant" | "daily" | "muted";
const emptyFeed: SubscriptionFeed = { items: [], total: 0, unread: 0, page: 1, pageSize: 12, totalPages: 1 };
const emptyContentSubscriptions: ContentSubscriptions = { topics: [], collections: [], tags: [] };
const emptySettings: SubscriptionSettings = { items: [], digestEnabled: true };
const emptyEmailSettings: SubscriptionEmailSettings = { available: false, enabled: false, unsubscribedAt: null, deliveries: [] };

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
  const [emailSettings, setEmailSettings] = useState<SubscriptionEmailSettings>(emptyEmailSettings);
  const [contentSubscriptions, setContentSubscriptions] = useState<ContentSubscriptions>(emptyContentSubscriptions);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (token: string) => {
    const [currentUser, currentFeed, currentSettings, currentContentSubscriptions, currentEmailSettings] = await Promise.all([
      getMe(token),
      listSubscriptionFeed(token, { page: 1, pageSize: 12, sort }),
      listSubscriptionSettings(token),
      listContentSubscriptions(token),
      getSubscriptionEmailSettings(token),
    ]);
    setUser(currentUser);
    setFeed(currentFeed);
    setSettings(currentSettings);
    setContentSubscriptions(currentContentSubscriptions);
    setEmailSettings(currentEmailSettings);
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
      await updateSubscriptionSetting(token, authorId, { notifyNewArticles: enabled });
      setSettings((current) => ({ ...current, items: current.items.map((item) => item.author.id === authorId ? { ...item, notifyNewArticles: enabled } : item) }));
      setNotice(enabled ? phrase("已恢复该作者的新内容推送。", "New-content notifications were enabled for this author.") : phrase("已关闭该作者的新内容推送。", "New-content notifications were disabled for this author."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("推送设置更新失败。", "Could not update notification settings."));
    }
  }

  async function changeAuthorFrequency(authorId: number, frequency: SubscriptionFrequency) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await updateSubscriptionSetting(token, authorId, { frequency });
      setSettings((current) => ({ ...current, items: current.items.map((item) => item.author.id === authorId ? { ...item, frequency } : item) }));
      setNotice(phrase("作者推送频率已更新。", "Author notification frequency updated."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("作者推送频率更新失败。", "Could not update author notification frequency."));
    }
  }

  async function changeTopicFrequency(topicId: number, frequency: SubscriptionFrequency) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await updateTopicSubscriptionFrequency(token, topicId, frequency);
      setContentSubscriptions((current) => ({ ...current, topics: current.topics.map((item) => item.id === topicId ? { ...item, frequency } : item) }));
      setNotice(phrase("专题推送频率已更新。", "Topic notification frequency updated."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("专题推送频率更新失败。", "Could not update topic notification frequency."));
    }
  }

  async function changeTagFrequency(tag: string, frequency: SubscriptionFrequency) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await updateTagSubscriptionFrequency(token, tag, frequency);
      setContentSubscriptions((current) => ({ ...current, tags: current.tags.map((item) => item.tag === tag ? { ...item, frequency } : item) }));
      setNotice(phrase("标签推送频率已更新。", "Tag notification frequency updated."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("标签推送频率更新失败。", "Could not update tag notification frequency."));
    }
  }

  async function removeTagSubscription(tag: string) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await unsubscribeTag(token, tag);
      setContentSubscriptions((current) => ({ ...current, tags: current.tags.filter((item) => item.tag !== tag) }));
      setNotice(phrase("已取消标签订阅。", "Tag unsubscribed."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("取消标签订阅失败。", "Could not unsubscribe from the tag."));
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

  async function toggleEmailDigest(enabled: boolean) {
    const token = readAccessToken();
    if (!token || !emailSettings.available) return;
    try {
      const next = await updateSubscriptionEmailSettings(token, enabled);
      setEmailSettings(next);
      setNotice(enabled ? phrase("已开启邮件订阅日报。", "Email subscription digest enabled.") : phrase("已关闭邮件订阅日报。", "Email subscription digest disabled."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("邮件日报设置更新失败。", "Could not update email digest settings."));
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

  async function removeAuthorSubscription(authorId: number) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await unsubscribeFromAuthor(token, authorId);
      setSettings((current) => ({ ...current, items: current.items.filter((item) => item.author.id !== authorId) }));
      setNotice(phrase("已取消作者订阅。", "Author unsubscribed."));
      await load(token);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("取消作者订阅失败。", "Could not unsubscribe from the author."));
    }
  }

  return <section className="page-shell subscription-feed-page">
    <ArticleCenterNav active="subscriptions" isLoggedIn user={user} />
    <div className="discovery-toolbar">
      <nav aria-label={phrase("订阅动态排序", "Subscription update sort")} className="discovery-sort-tabs article-center-secondary-tabs">
        {(["latest", "unread", "popular"] as FeedSort[]).map((value) => <button className={sort === value ? "active" : undefined} key={value} onClick={() => router.replace(value === "latest" ? localizedPath("/articles/subscriptions", locale) : `${localizedPath("/articles/subscriptions", locale)}?sort=${value}`)} type="button">{value === "latest" ? phrase("最新", "Latest") : value === "unread" ? phrase(`未读 ${feed.unread}`, `Unread ${feed.unread}`) : phrase("热度", "Popular")}</button>)}
      </nav>
      <span className="discovery-toolbar-actions">
        <button aria-label={phrase("订阅管理", "Manage subscriptions")} className={settingsOpen ? "active" : undefined} onClick={() => setSettingsOpen(true)} title={phrase("订阅管理", "Manage subscriptions")} type="button"><SlidersHorizontal aria-hidden="true" size={17} /></button>
        <button aria-label={phrase("全部已读", "Mark all as read")} disabled={!feed.unread} onClick={() => void markAll()} title={phrase("全部已读", "Mark all as read")} type="button"><CheckCheck aria-hidden="true" size={18} /></button>
      </span>
    </div>
    {settingsOpen && typeof document !== "undefined" ? createPortal(
      <div className="subscription-management-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }} role="presentation">
        <aside aria-label={phrase("订阅管理", "Manage subscriptions")} aria-modal="true" className="subscription-settings-panel subscription-management-panel subscription-management-drawer" role="dialog">
          <header><span><strong>{phrase("订阅管理", "Manage subscriptions")}</strong><small>{phrase("作者、专题、标签和合集的订阅设置。", "Manage author, topic, tag, and collection subscriptions.")}</small></span><div><button aria-label={settings.digestEnabled ? phrase("关闭订阅日报", "Disable subscription digest") : phrase("开启订阅日报", "Enable subscription digest")} aria-pressed={settings.digestEnabled} className={settings.digestEnabled ? "active" : undefined} onClick={() => void toggleDigest(!settings.digestEnabled)} title={settings.digestEnabled ? phrase("关闭订阅日报", "Disable subscription digest") : phrase("开启订阅日报", "Enable subscription digest")} type="button">{settings.digestEnabled ? <Bell aria-hidden="true" size={16} /> : <BellOff aria-hidden="true" size={16} />}</button><button aria-label={phrase("关闭", "Close")} onClick={() => setSettingsOpen(false)} title={phrase("关闭", "Close")} type="button"><X aria-hidden="true" size={17} /></button></div></header>
          <div className="subscription-management-groups">
            <section><h3><Mail aria-hidden="true" size={14} />{phrase("邮件日报", "Email digest")}</h3><div className="subscription-digest-setting"><span><strong>{phrase("每日邮件汇总", "Daily email summary")}</strong><small>{!emailSettings.available ? phrase("邮件服务尚未启用", "Email service is not configured") : emailSettings.enabled ? phrase("每天发送当前可见的新订阅内容", "Send currently visible subscription updates daily") : phrase("已暂停邮件日报", "Email digests are paused")}</small>{emailSettings.deliveries[0] ? <small className="subscription-email-delivery">{phrase(`最近投递：${emailSettings.deliveries[0].status === "sent" ? "成功" : emailSettings.deliveries[0].status === "failed" ? "失败" : "处理中"}`, `Latest delivery: ${emailSettings.deliveries[0].status}`)}</small> : null}</span><button aria-label={emailSettings.enabled ? phrase("关闭邮件日报", "Disable email digest") : phrase("开启邮件日报", "Enable email digest")} aria-pressed={emailSettings.enabled} className={emailSettings.enabled ? "active" : undefined} disabled={!emailSettings.available} onClick={() => void toggleEmailDigest(!emailSettings.enabled)} title={emailSettings.enabled ? phrase("关闭邮件日报", "Disable email digest") : phrase("开启邮件日报", "Enable email digest")} type="button">{emailSettings.enabled ? <Bell aria-hidden="true" size={16} /> : <BellOff aria-hidden="true" size={16} />}</button></div></section>
            <section><h3><Bell aria-hidden="true" size={14} />{phrase("作者推送", "Author notifications")}</h3><div>{settings.items.map((item) => <div className="subscription-author-setting" key={item.author.id}><span>{item.author.nickname}<small>@{item.author.username}</small></span><span className="subscription-setting-actions"><FrequencySelect value={item.frequency} onChange={(frequency) => void changeAuthorFrequency(item.author.id, frequency)} /><button aria-label={phrase(`${item.notifyNewArticles ? "关闭" : "开启"}${item.author.nickname}的新内容推送`, `${item.notifyNewArticles ? "Disable" : "Enable"} new-content notifications for ${item.author.nickname}`)} aria-pressed={item.notifyNewArticles} className={item.notifyNewArticles ? "active" : undefined} onClick={() => void toggleAuthor(item.author.id, !item.notifyNewArticles)} title={item.notifyNewArticles ? phrase("关闭推送", "Disable notifications") : phrase("开启推送", "Enable notifications")} type="button">{item.notifyNewArticles ? <Bell aria-hidden="true" size={16} /> : <BellOff aria-hidden="true" size={16} />}</button><button aria-label={`${phrase("取消订阅", "Unsubscribe")} ${item.author.nickname}`} className="subscription-unsubscribe-action" onClick={() => void removeAuthorSubscription(item.author.id)} title={phrase("取消订阅", "Unsubscribe")} type="button"><Rss aria-hidden="true" size={16} /></button></span></div>)}{!settings.items.length ? <p>{phrase("还没有订阅作者。", "No authors are subscribed yet.")}</p> : null}</div></section>
            <section><h3><BookOpen aria-hidden="true" size={14} />{phrase("专题", "Topics")}</h3><div>{contentSubscriptions.topics.map((topic) => <div className="subscription-content-setting" key={topic.id}><Link href={localizedPath(`/topics/${topic.slug}`, locale)}><strong>{topic.title}</strong><small>{phrase(`${topic.articleCount} 篇 · ${topic.subscriberCount} 人订阅`, `${topic.articleCount} articles · ${topic.subscriberCount} subscribers`)}</small></Link><span className="subscription-setting-actions"><FrequencySelect value={topic.frequency} onChange={(frequency) => void changeTopicFrequency(topic.id, frequency)} /><button aria-label={`${phrase("取消订阅", "Unsubscribe")} ${topic.title}`} className="subscription-unsubscribe-action" onClick={() => void removeTopicSubscription(topic.id)} title={phrase("取消订阅", "Unsubscribe")} type="button"><Rss aria-hidden="true" size={16} /></button></span></div>)}{!contentSubscriptions.topics.length ? <p>{phrase("还没有订阅专题。", "No topics are subscribed yet.")}</p> : null}</div></section>
            <section><h3><Hash aria-hidden="true" size={14} />{phrase("标签", "Tags")}</h3><div>{contentSubscriptions.tags.map((item) => <div className="subscription-content-setting" key={item.tag}><span className="subscription-tag-name">#{item.tag}</span><span className="subscription-setting-actions"><FrequencySelect value={item.frequency} onChange={(frequency) => void changeTagFrequency(item.tag, frequency)} /><button aria-label={`${phrase("取消订阅", "Unsubscribe")} #${item.tag}`} className="subscription-unsubscribe-action" onClick={() => void removeTagSubscription(item.tag)} title={phrase("取消订阅", "Unsubscribe")} type="button"><Rss aria-hidden="true" size={16} /></button></span></div>)}{!contentSubscriptions.tags.length ? <p>{phrase("还没有订阅标签。", "No tags are subscribed yet.")}</p> : null}</div></section>
            <section><h3><FolderOpen aria-hidden="true" size={14} />{phrase("合集", "Collections")}</h3><div>{contentSubscriptions.collections.map((collection) => <div className="subscription-content-setting" key={collection.id}><Link href={localizedPath(`/collections/${collection.id}`, locale)}><strong>{collection.name}</strong><small>{phrase(`${collection.owner.nickname} · ${collection.articleCount} 篇`, `${collection.owner.nickname} · ${collection.articleCount} articles`)}</small></Link><button aria-label={`${phrase("取消订阅", "Unsubscribe")} ${collection.name}`} className="subscription-unsubscribe-action" onClick={() => void removeCollectionSubscription(collection.id)} title={phrase("取消订阅", "Unsubscribe")} type="button"><Rss aria-hidden="true" size={16} /></button></div>)}{!contentSubscriptions.collections.length ? <p>{phrase("还没有订阅合集。", "No collections are subscribed yet.")}</p> : null}</div></section>
          </div>
        </aside>
      </div>, document.body) : null}
    {isLoading ? <div className="article-empty-state">{phrase("正在读取订阅动态。", "Loading subscription updates.")}</div> : feed.items.length ? <div className="discovery-feed-list">{feed.items.map((item) => <DiscoveryArticleRow article={item.article} key={item.article.id} onOpen={() => void markRead(item.article.id)} unread={!item.readAt} />)}</div> : <div className="article-empty-state"><strong>{phrase("订阅动态还是空的", "No subscription updates yet")}</strong><span>{phrase("订阅作者后，新发布的内容会集中出现在这里。", "New articles from subscribed authors appear here.")}</span></div>}
    {feed.items.length ? <ArticleInfiniteFooter hasMore={feed.page < feed.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
    <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function FrequencySelect({ value, onChange }: { value: SubscriptionFrequency; onChange: (value: SubscriptionFrequency) => void }) {
  const { phrase } = useLanguage();
  return <GlassSelect ariaLabel={phrase("订阅频率", "Subscription frequency")} menuClassName="subscription-frequency-menu" menuPortal onChange={onChange} options={[{ value: "instant" as const, label: phrase("即时", "Instant") }, { value: "daily" as const, label: phrase("日报", "Daily") }, { value: "muted" as const, label: phrase("静音", "Muted") }]} value={value} />;
}
