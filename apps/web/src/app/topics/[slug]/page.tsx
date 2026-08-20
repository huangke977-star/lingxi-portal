"use client";

/* eslint-disable @next/next/no-img-element */

import { useParams } from "next/navigation";
import { Rss } from "lucide-react";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { DiscoveryArticleRow } from "@/components/discovery-ui";
import { AppToast } from "@/components/app-toast";
import { getMe, resolveApiUrl, type AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { getTopic, subscribeTopic, unsubscribeTopic, type ArticleTopic } from "@/lib/discovery-api";

export default function TopicDetailPage() {
  const params = useParams<{ slug: string }>();
  const [topic, setTopic] = useState<ArticleTopic | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isActing, setIsActing] = useState(false);
  useEffect(() => {
    const token = readAccessToken();
    Promise.all([token ? getMe(token).catch(() => null) : Promise.resolve(null), getTopic(decodeURIComponent(params.slug), token)])
      .then(([currentUser, currentTopic]) => { setUser(currentUser); setTopic(currentTopic); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "专题加载失败。"));
  }, [params.slug]);
  async function toggleSubscription() {
    const token = readAccessToken();
    if (!token || !topic) return;
    setIsActing(true);
    try {
      const result = topic.subscribed ? await unsubscribeTopic(token, topic.id) : await subscribeTopic(token, topic.id);
      setTopic({ ...topic, subscribed: result.subscribed, subscriberCount: result.subscriberCount });
      setNotice(result.subscribed ? "已订阅专题。" : "已取消专题订阅。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "专题订阅操作失败。");
    } finally {
      setIsActing(false);
    }
  }
  return <section className="page-shell topic-detail-page"><ArticleCenterNav active="topics" isLoggedIn={Boolean(user)} user={user} />{topic ? <><header className={`content-group-header topic${topic.coverPath ? " with-cover" : ""}`}>{topic.coverPath ? <img alt="" src={resolveApiUrl(topic.coverPath)} /> : null}{user ? <button aria-label={topic.subscribed ? "取消订阅专题" : "订阅专题"} className={`content-group-subscribe topic-detail-subscribe${topic.subscribed ? " active" : ""}`} disabled={isActing} onClick={() => void toggleSubscription()} title={topic.subscribed ? "取消订阅" : "订阅"} type="button"><Rss aria-hidden="true" size={17} /></button> : null}<span>内容专题</span><h1>{topic.title}</h1><p>{topic.description || "这个专题暂时没有说明。"}</p><small>{topic.articleCount} 篇文章 · {topic.subscriberCount} 人订阅</small></header><div className="discovery-feed-list">{topic.articles.map((article) => <DiscoveryArticleRow article={article} key={article.id} />)}</div>{!topic.articles.length ? <div className="article-empty-state">这个专题还没有可见文章。</div> : null}</> : <div className="article-empty-state">正在读取专题。</div>}<AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}
