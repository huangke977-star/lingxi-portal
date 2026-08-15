"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ArrowRight, Search, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { AppToast } from "@/components/app-toast";
import { getMe, resolveApiUrl, type AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { listTopics, type ArticleTopic } from "@/lib/discovery-api";

export default function TopicsPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [topics, setTopics] = useState<ArticleTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
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
  const canManage = Boolean(user?.isSuperAdmin || (user?.role.level ?? 0) >= 90);
  return <section className="page-shell topics-page"><ArticleCenterNav active="topics" isLoggedIn={Boolean(user)} user={user} /><div className="topics-toolbar"><span>{topics.length} 个可见专题</span><div><label className="topics-search"><Search aria-hidden="true" size={15} /><input aria-label="搜索专题" onChange={(event) => setQuery(event.target.value)} placeholder="搜索专题" value={query} /></label>{canManage ? <Link href="/admin/topics"><Settings2 aria-hidden="true" size={16} />管理专题</Link> : null}</div></div>{isLoading ? <div className="article-empty-state">正在读取专题。</div> : topics.length ? <div className="topic-list">{topics.map((topic) => <Link aria-label={`查看专题 ${topic.title}`} className="topic-card" href={`/topics/${topic.slug}`} key={topic.id}>{topic.coverPath ? <img alt="" src={resolveApiUrl(topic.coverPath)} /> : <span className="topic-cover-fallback">{topic.title.slice(0, 2)}</span>}<div><span>专题 · {topic.articleCount} 篇</span><h2>{topic.title}</h2><p>{topic.description || "暂时没有专题说明。"}</p><ul>{topic.articles.slice(0, 3).map((article) => <li key={article.id}>{article.title}</li>)}</ul></div><span className="topic-card-arrow"><ArrowRight aria-hidden="true" size={18} /></span></Link>)}</div> : <div className="article-empty-state">没有找到匹配的专题。</div>}<AppToast message={error} onDismiss={() => setError("")} tone="error" /></section>;
}
