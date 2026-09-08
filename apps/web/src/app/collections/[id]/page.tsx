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
import { getCollection, subscribeCollection, unsubscribeCollection, type ArticleCollection } from "@/lib/discovery-api";
import { getOfflineEntry, offlineCollectionEntry, saveOfflineEntry } from "@/lib/offline-cache";
import { OfflineSaveButton } from "@/components/offline-save-button";

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
    void (async () => {
      const collectionId = String(params.id);
      const cachedCollection = await getOfflineEntry<ArticleCollection>("collection", collectionId).then((entry) => entry?.data ?? null).catch(() => null);
      if (cachedCollection) {
        setCollection(cachedCollection);
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setUser(null);
        setCollection(cachedCollection);
        if (cachedCollection) setNotice(phrase("当前为离线阅读，订阅操作暂不可用。", "Offline reading is active. Subscription actions are unavailable."));
        else setError(phrase("当前没有网络，且这个合集尚未保存到本机。", "You are offline and this collection has not been saved on this device."));
        return;
      }
      const [userResult, collectionResult] = await Promise.allSettled([
        token ? getMe(token).catch(() => null) : Promise.resolve(null),
        getCollection(Number(params.id), token),
      ] as const);
      const currentUser = userResult.status === "fulfilled" ? userResult.value : null;
      let currentCollection: ArticleCollection | null = collectionResult.status === "fulfilled" ? collectionResult.value : null;
      if (currentCollection) {
        void refreshOfflineCollection(currentCollection);
      } else {
        currentCollection = cachedCollection;
        if (currentCollection) setNotice(phrase("当前为离线阅读，订阅操作暂不可用。", "Offline reading is active. Subscription actions are unavailable."));
      }
      setUser(currentUser);
      setCollection(currentCollection);
      if (!currentCollection && collectionResult.status === "rejected") setError(collectionResult.reason instanceof Error ? collectionResult.reason.message : phrase("合集加载失败。", "Could not load the collection."));
    })();
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
  return <section className="page-shell public-collection-page"><ArticleCenterNav active="collections" isLoggedIn={Boolean(user)} user={user} />{collection ? <><header className="content-group-header"><div className="content-group-header-copy"><h1>{collection.name}</h1><small>{phrase(`${collection.articleCount} 篇文章 · ${collection.subscriberCount} 人订阅`, `${collection.articleCount} articles · ${collection.subscriberCount} subscribers`)}</small></div><div className="content-group-actions"><a aria-label={phrase("通过 RSS 阅读器订阅合集更新", "Subscribe to this collection in an RSS reader")} className="content-group-feed-link" href={resolveApiUrl(`/distribution/feeds/collections/${collection.id}.rss`)} rel="alternate" title={phrase("站外订阅", "External feed")}><Radio aria-hidden="true" size={16} /><span>{phrase("站外订阅", "External feed")}</span></a>{user && collection.owner.id !== user.id ? <button aria-label={collection.subscribed ? t("common.unsubscribe") : t("common.subscribe")} className={`content-group-subscribe${collection.subscribed ? " active" : ""}`} disabled={isActing} onClick={() => void toggleSubscription()} title={collection.subscribed ? t("common.unsubscribe") : t("common.subscribe")} type="button"><Rss aria-hidden="true" size={17} /></button> : null}<OfflineSaveButton data={collection} id={String(collection.id)} kind="collection" mediaUrls={offlineCollectionEntry(collection).mediaUrls} route={`/collections/${collection.id}`} title={collection.name} updatedAt={collection.updatedAt} /></div></header><div className="discovery-feed-list">{collection.articles.map((article) => <DiscoveryArticleRow article={article} key={article.id} />)}</div>{!collection.articles.length ? <div className="article-empty-state">{phrase("这个合集还没有可见文章。", "This collection has no visible articles yet.")}</div> : null}</> : <div className="article-empty-state">{error || phrase("正在读取合集。", "Loading collection.")}</div>}<AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}

async function refreshOfflineCollection(collection: ArticleCollection): Promise<void> {
  const existing = await getOfflineEntry<ArticleCollection>("collection", String(collection.id)).catch(() => null);
  if (!existing) return;
  await saveOfflineEntry({ ...offlineCollectionEntry(collection), stale: false }).catch(() => undefined);
}
