"use client";

import { useParams } from "next/navigation";
import { Radio, Rss } from "lucide-react";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { DiscoveryArticleRow } from "@/components/discovery-ui";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { getMe, resolveApiUrl, type AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { getTopic, subscribeTopic, unsubscribeTopic, type ArticleTopic } from "@/lib/discovery-api";
import { getOfflineEntry, offlineTopicEntry, saveOfflineEntry } from "@/lib/offline-cache";
import { OfflineSaveButton } from "@/components/offline-save-button";

export default function TopicDetailPage() {
  const params = useParams<{ slug: string }>();
  const { phrase, t } = useLanguage();
  const [topic, setTopic] = useState<ArticleTopic | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isActing, setIsActing] = useState(false);
  useEffect(() => {
    const token = readAccessToken();
    void (async () => {
      const topicSlug = decodeURIComponent(params.slug);
      const cachedTopic = await getOfflineEntry<ArticleTopic>("topic", topicSlug).then((entry) => entry?.data ?? null).catch(() => null);
      if (cachedTopic) {
        setTopic(cachedTopic);
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setUser(null);
        setTopic(cachedTopic);
        if (cachedTopic) setNotice(phrase("当前为离线阅读，订阅操作暂不可用。", "Offline reading is active. Subscription actions are unavailable."));
        else setError(phrase("当前没有网络，且这个专题尚未保存到本机。", "You are offline and this topic has not been saved on this device."));
        return;
      }
      const [userResult, topicResult] = await Promise.allSettled([
        token ? getMe(token).catch(() => null) : Promise.resolve(null),
        getTopic(topicSlug, token),
      ] as const);
      const currentUser = userResult.status === "fulfilled" ? userResult.value : null;
      let currentTopic: ArticleTopic | null = topicResult.status === "fulfilled" ? topicResult.value : null;
      if (currentTopic) {
        void refreshOfflineTopic(currentTopic);
      } else {
        currentTopic = cachedTopic;
        if (currentTopic) setNotice(phrase("当前为离线阅读，订阅操作暂不可用。", "Offline reading is active. Subscription actions are unavailable."));
      }
      setUser(currentUser);
      setTopic(currentTopic);
      if (!currentTopic && topicResult.status === "rejected") setError(topicResult.reason instanceof Error ? topicResult.reason.message : phrase("专题加载失败。", "Could not load the topic."));
    })();
  }, [params.slug, phrase]);
  async function toggleSubscription() {
    const token = readAccessToken();
    if (!token || !topic) return;
    setIsActing(true);
    try {
      const result = topic.subscribed ? await unsubscribeTopic(token, topic.id) : await subscribeTopic(token, topic.id);
      setTopic({ ...topic, subscribed: result.subscribed, subscriberCount: result.subscriberCount });
      setNotice(result.subscribed ? phrase("已订阅专题。", "Topic subscribed.") : phrase("已取消专题订阅。", "Topic unsubscribed."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("专题订阅操作失败。", "Could not update the topic subscription."));
    } finally {
      setIsActing(false);
    }
  }
  return <section className="page-shell topic-detail-page"><ArticleCenterNav active="topics" isLoggedIn={Boolean(user)} user={user} />{topic ? <><header className="content-group-header"><div className="content-group-header-copy"><h1>{topic.title}</h1><small>{phrase(`${topic.articleCount} 篇文章 · ${topic.subscriberCount} 人订阅`, `${topic.articleCount} articles · ${topic.subscriberCount} subscribers`)}</small></div><div className="content-group-actions"><a aria-label={phrase("通过 RSS 阅读器订阅专题更新", "Subscribe to this topic in an RSS reader")} className="content-group-feed-link" href={resolveApiUrl(`/distribution/feeds/topics/${encodeURIComponent(topic.slug)}.rss`)} rel="alternate" title={phrase("站外订阅", "External feed")}><Radio aria-hidden="true" size={16} /><span>{phrase("站外订阅", "External feed")}</span></a>{user ? <button aria-label={topic.subscribed ? t("common.unsubscribe") : t("common.subscribe")} className={`content-group-subscribe topic-detail-subscribe${topic.subscribed ? " active" : ""}`} disabled={isActing} onClick={() => void toggleSubscription()} title={topic.subscribed ? t("common.unsubscribe") : t("common.subscribe")} type="button"><Rss aria-hidden="true" size={17} /></button> : null}<OfflineSaveButton data={topic} id={topic.slug} kind="topic" mediaUrls={offlineTopicEntry(topic).mediaUrls} route={`/topics/${topic.slug}`} title={topic.title} updatedAt={topic.updatedAt} /></div></header><div className="discovery-feed-list">{topic.articles.map((article) => <DiscoveryArticleRow article={article} key={article.id} />)}</div>{!topic.articles.length ? <div className="article-empty-state">{phrase("这个专题还没有可见文章。", "This topic has no visible articles yet.")}</div> : null}</> : <div className="article-empty-state">{error || phrase("正在读取专题。", "Loading topic.")}</div>}<AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}

async function refreshOfflineTopic(topic: ArticleTopic): Promise<void> {
  const existing = await getOfflineEntry<ArticleTopic>("topic", topic.slug).catch(() => null);
  if (!existing) return;
  await saveOfflineEntry({ ...offlineTopicEntry(topic), stale: false }).catch(() => undefined);
}
