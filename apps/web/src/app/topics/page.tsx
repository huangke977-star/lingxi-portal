"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ArrowRight, Settings2 } from "lucide-react";
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
  useEffect(() => {
    const token = readAccessToken();
    Promise.all([token ? getMe(token).catch(() => null) : Promise.resolve(null), listTopics(token, { page: 1, pageSize: 50 })])
      .then(([currentUser, result]) => { setUser(currentUser); setTopics(result.items); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "专题加载失败。"))
      .finally(() => setIsLoading(false));
  }, []);
  const canManage = Boolean(user?.isSuperAdmin || (user?.role.level ?? 0) >= 90);
  return <section className="page-shell topics-page"><ArticleCenterNav active="topics" isLoggedIn={Boolean(user)} user={user} /><div className="topics-toolbar"><span>{topics.length} 个可见专题</span>{canManage ? <Link href="/admin/topics"><Settings2 aria-hidden="true" size={16} />管理专题</Link> : null}</div>{isLoading ? <div className="article-empty-state">正在读取专题。</div> : topics.length ? <div className="topic-list">{topics.map((topic) => <Link aria-label={`查看专题 ${topic.title}`} className="topic-card" href={`/topics/${topic.slug}`} key={topic.id}>{topic.coverPath ? <img alt="" src={resolveApiUrl(topic.coverPath)} /> : <span className="topic-cover-fallback">{topic.title.slice(0, 2)}</span>}<div><span>专题 · {topic.articleCount} 篇</span><h2>{topic.title}</h2><p>{topic.description || "暂时没有专题说明。"}</p><ul>{topic.articles.slice(0, 3).map((article) => <li key={article.id}>{article.title}</li>)}</ul></div><span className="topic-card-arrow"><ArrowRight aria-hidden="true" size={18} /></span></Link>)}</div> : <div className="article-empty-state">目前还没有可见专题。</div>}<AppToast message={error} onDismiss={() => setError("")} tone="error" /></section>;
}
