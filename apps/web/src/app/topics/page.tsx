"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Rss, Search, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { AppToast } from "@/components/app-toast";
import { getMe, resolveApiUrl, type AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { listTopics, subscribeTopic, unsubscribeTopic, type ArticleTopic } from "@/lib/discovery-api";
import { isSiteManager } from "@/lib/user-permissions";

export default function TopicsPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [topics, setTopics] = useState<ArticleTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [actingId, setActingId] = useState<number | null>(null);
  useEffect(() => {
    const token = readAccessToken();
    if (token) getMe(token).then(setUser).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    const token = readAccessToken();
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      listTopics(token, { page: 1, pageSize: 50, q: query })
      .then((result) => setTopics(result.items))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "专题加载失败。"))
      .finally(() => setIsLoading(false));
    }, query ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [query]);
  async function toggleSubscription(topic: ArticleTopic) {
    const token = readAccessToken();
    if (!token) return;
    setActingId(topic.id);
    try {
      const result = topic.subscribed ? await unsubscribeTopic(token, topic.id) : await subscribeTopic(token, topic.id);
      setTopics((current) => current.map((item) => item.id === topic.id ? { ...item, subscribed: result.subscribed, subscriberCount: result.subscriberCount } : item));
      setNotice(result.subscribed ? "已订阅专题。" : "已取消专题订阅。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "专题订阅操作失败。");
    } finally {
      setActingId(null);
    }
  }
  const canManage = isSiteManager(user);
  return <section className="page-shell topics-page"><ArticleCenterNav active="topics" isLoggedIn={Boolean(user)} user={user} /><div className="topics-toolbar"><span>{topics.length} 个可见专题</span><div><label className="topics-search"><Search aria-hidden="true" size={15} /><input aria-label="搜索专题" onChange={(event) => setQuery(event.target.value)} placeholder="搜索专题" value={query} /></label>{canManage ? <Link href="/admin/topics"><Settings2 aria-hidden="true" size={16} />管理专题</Link> : null}</div></div>{isLoading ? <div className="article-empty-state">正在读取专题。</div> : topics.length ? <div className="topic-list">{topics.map((topic) => <article className="topic-card" key={topic.id}><Link aria-label={`查看专题 ${topic.title}`} className="topic-card-link" href={`/topics/${topic.slug}`}><span className="topic-card-cover">{topic.coverPath ? <img alt="" src={resolveApiUrl(topic.coverPath)} /> : <strong>{topic.title.slice(0, 2)}</strong>}<small>{topic.articleCount} 篇</small></span><span className="topic-card-body"><strong>{topic.title}</strong><small>{topic.description || "暂时没有专题说明。"}</small><em>{topic.articles.slice(0, 2).map((article) => article.title).join(" · ") || "等待内容加入"}</em></span></Link><footer><span>{topic.subscriberCount} 人订阅</span>{user ? <button aria-label={topic.subscribed ? `取消订阅 ${topic.title}` : `订阅 ${topic.title}`} className={topic.subscribed ? "active" : undefined} disabled={actingId === topic.id} onClick={() => void toggleSubscription(topic)} title={topic.subscribed ? "取消订阅" : "订阅"} type="button"><Rss aria-hidden="true" size={15} /></button> : null}</footer></article>)}</div> : <div className="article-empty-state">没有找到匹配的专题。</div>}<AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}
