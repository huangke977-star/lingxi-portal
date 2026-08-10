"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { DiscoveryArticleRow } from "@/components/discovery-ui";
import { AppToast } from "@/components/app-toast";
import { getMe, type AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { getCollection, type ArticleCollection } from "@/lib/discovery-api";

export default function PublicCollectionPage() {
  const params = useParams<{ id: string }>();
  const [collection, setCollection] = useState<ArticleCollection | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = readAccessToken();
    Promise.all([token ? getMe(token).catch(() => null) : Promise.resolve(null), getCollection(Number(params.id), token)])
      .then(([currentUser, currentCollection]) => { setUser(currentUser); setCollection(currentCollection); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "合集加载失败。"));
  }, [params.id]);
  return <section className="page-shell public-collection-page"><ArticleCenterNav active="collections" isLoggedIn={Boolean(user)} user={user} />{collection ? <><header className="content-group-header"><span>文章合集</span><h1>{collection.name}</h1><p>{collection.description || "这个合集暂时没有说明。"}</p><small>{collection.owner.nickname} · {collection.articleCount} 篇</small></header><div className="discovery-feed-list">{collection.articles.map((article) => <DiscoveryArticleRow article={article} key={article.id} />)}</div>{!collection.articles.length ? <div className="article-empty-state">这个合集还没有可见文章。</div> : null}</> : <div className="article-empty-state">正在读取合集。</div>}<AppToast message={error} onDismiss={() => setError("")} tone="error" /></section>;
}
