"use client";

import { useParams } from "next/navigation";
import { Rss } from "lucide-react";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { DiscoveryArticleRow } from "@/components/discovery-ui";
import { AppToast } from "@/components/app-toast";
import { getMe, type AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { getCollection, subscribeCollection, unsubscribeCollection, type ArticleCollection } from "@/lib/discovery-api";

export default function PublicCollectionPage() {
  const params = useParams<{ id: string }>();
  const [collection, setCollection] = useState<ArticleCollection | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isActing, setIsActing] = useState(false);
  useEffect(() => {
    const token = readAccessToken();
    Promise.all([token ? getMe(token).catch(() => null) : Promise.resolve(null), getCollection(Number(params.id), token)])
      .then(([currentUser, currentCollection]) => { setUser(currentUser); setCollection(currentCollection); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "合集加载失败。"));
  }, [params.id]);
  async function toggleSubscription() {
    const token = readAccessToken();
    if (!token || !collection || collection.owner.id === user?.id) return;
    setIsActing(true);
    try {
      const result = collection.subscribed ? await unsubscribeCollection(token, collection.id) : await subscribeCollection(token, collection.id);
      setCollection({ ...collection, subscribed: result.subscribed, subscriberCount: result.subscriberCount });
      setNotice(result.subscribed ? "已订阅合集。" : "已取消合集订阅。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "合集订阅操作失败。");
    } finally {
      setIsActing(false);
    }
  }
  return <section className="page-shell public-collection-page"><ArticleCenterNav active="collections" isLoggedIn={Boolean(user)} user={user} />{collection ? <><header className="content-group-header">{user && collection.owner.id !== user.id ? <button aria-label={collection.subscribed ? "取消订阅合集" : "订阅合集"} className={`content-group-subscribe${collection.subscribed ? " active" : ""}`} disabled={isActing} onClick={() => void toggleSubscription()} title={collection.subscribed ? "取消订阅" : "订阅"} type="button"><Rss aria-hidden="true" size={17} /></button> : null}<span>文章合集</span><h1>{collection.name}</h1><p>{collection.description || "这个合集暂时没有说明。"}</p><small>{collection.owner.nickname} · {collection.articleCount} 篇 · {collection.subscriberCount} 人订阅</small></header><div className="discovery-feed-list">{collection.articles.map((article) => <DiscoveryArticleRow article={article} key={article.id} />)}</div>{!collection.articles.length ? <div className="article-empty-state">这个合集还没有可见文章。</div> : null}</> : <div className="article-empty-state">正在读取合集。</div>}<AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}
