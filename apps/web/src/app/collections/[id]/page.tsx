"use client";

import { useParams } from "next/navigation";
import { Rss } from "lucide-react";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { DiscoveryArticleRow } from "@/components/discovery-ui";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { getMe, resolveApiUrl, type AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { getCollection, subscribeCollection, unsubscribeCollection, type ArticleCollection } from "@/lib/discovery-api";

export default function PublicCollectionPage() {
  const params = useParams<{ id: string }>();
  const { phrase, t } = useLanguage();
  const [collection, setCollection] = useState<ArticleCollection | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isActing, setIsActing] = useState(false);
  useEffect(() => {
    const token = readAccessToken();
    Promise.all([token ? getMe(token).catch(() => null) : Promise.resolve(null), getCollection(Number(params.id), token)])
      .then(([currentUser, currentCollection]) => { setUser(currentUser); setCollection(currentCollection); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : phrase("合集加载失败。", "Could not load the collection.")));
  }, [params.id, phrase]);
  async function toggleSubscription() {
    const token = readAccessToken();
    if (!token || !collection || collection.owner.id === user?.id) return;
    setIsActing(true);
    try {
      const result = collection.subscribed ? await unsubscribeCollection(token, collection.id) : await subscribeCollection(token, collection.id);
      setCollection({ ...collection, subscribed: result.subscribed, subscriberCount: result.subscriberCount });
      setNotice(result.subscribed ? phrase("已订阅合集。", "Collection subscribed.") : phrase("已取消合集订阅。", "Collection unsubscribed."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("合集订阅操作失败。", "Could not update the collection subscription."));
    } finally {
      setIsActing(false);
    }
  }
  return <section className="page-shell public-collection-page"><ArticleCenterNav active="collections" isLoggedIn={Boolean(user)} user={user} />{collection ? <><header className="content-group-header"><a aria-label={phrase("订阅此合集的 RSS", "Subscribe to this collection via RSS")} className="content-group-feed-link" href={resolveApiUrl(`/distribution/feeds/collections/${collection.id}.rss`)} rel="alternate" title={phrase("RSS 订阅源", "RSS feed")}><Rss aria-hidden="true" size={16} /></a>{user && collection.owner.id !== user.id ? <button aria-label={collection.subscribed ? t("common.unsubscribe") : t("common.subscribe")} className={`content-group-subscribe${collection.subscribed ? " active" : ""}`} disabled={isActing} onClick={() => void toggleSubscription()} title={collection.subscribed ? t("common.unsubscribe") : t("common.subscribe")} type="button"><Rss aria-hidden="true" size={17} /></button> : null}<span>{phrase("文章合集", "Article collection")}</span><h1>{collection.name}</h1><p>{collection.description || phrase("这个合集暂时没有说明。", "No collection description yet.")}</p><small>{phrase(`${collection.owner.nickname} · ${collection.articleCount} 篇 · ${collection.subscriberCount} 人订阅`, `${collection.owner.nickname} · ${collection.articleCount} articles · ${collection.subscriberCount} subscribers`)}</small></header><div className="discovery-feed-list">{collection.articles.map((article) => <DiscoveryArticleRow article={article} key={article.id} />)}</div>{!collection.articles.length ? <div className="article-empty-state">{phrase("这个合集还没有可见文章。", "This collection has no visible articles yet.")}</div> : null}</> : <div className="article-empty-state">{phrase("正在读取合集。", "Loading collection.")}</div>}<AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}
