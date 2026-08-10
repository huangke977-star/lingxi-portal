"use client";

/* eslint-disable @next/next/no-img-element */

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { DiscoveryArticleRow } from "@/components/discovery-ui";
import { AppToast } from "@/components/app-toast";
import { getMe, resolveApiUrl, type AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { getTopic, type ArticleTopic } from "@/lib/discovery-api";

export default function TopicDetailPage() {
  const params = useParams<{ slug: string }>();
  const [topic, setTopic] = useState<ArticleTopic | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = readAccessToken();
    Promise.all([token ? getMe(token).catch(() => null) : Promise.resolve(null), getTopic(decodeURIComponent(params.slug), token)])
      .then(([currentUser, currentTopic]) => { setUser(currentUser); setTopic(currentTopic); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "专题加载失败。"));
  }, [params.slug]);
  return <section className="page-shell topic-detail-page"><ArticleCenterNav active="topics" isLoggedIn={Boolean(user)} user={user} />{topic ? <><header className={`content-group-header topic${topic.coverPath ? " with-cover" : ""}`}>{topic.coverPath ? <img alt="" src={resolveApiUrl(topic.coverPath)} /> : null}<span>内容专题</span><h1>{topic.title}</h1><p>{topic.description || "这个专题暂时没有说明。"}</p><small>{topic.articleCount} 篇文章</small></header><div className="discovery-feed-list">{topic.articles.map((article) => <DiscoveryArticleRow article={article} key={article.id} />)}</div>{!topic.articles.length ? <div className="article-empty-state">这个专题还没有可见文章。</div> : null}</> : <div className="article-empty-state">正在读取专题。</div>}<AppToast message={error} onDismiss={() => setError("")} tone="error" /></section>;
}
