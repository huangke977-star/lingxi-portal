"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bell,
  BookOpenText,
  Compass,
  FolderOpen,
  LayoutGrid,
  Wrench,
} from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { PortalEntryVisual } from "@/components/portal-entry-visual";
import { listVisibleArticles, listPublicArticles, type Article } from "@/lib/article-api";
import { listAnnouncements, type AnnouncementSummary } from "@/lib/announcements-api";
import { AUTH_STATE_CHANGE_EVENT, readAccessToken } from "@/lib/auth-storage";
import { listTopics, listVisibleCollections, type ArticleCollection, type ArticleTopic } from "@/lib/discovery-api";
import {
  getPortalPreferences,
  listPortalContent,
  type PortalEntry,
  type PortalPreferences,
} from "@/lib/portal-api";

interface HomeData {
  announcements: AnnouncementSummary[];
  articles: Article[];
  collections: ArticleCollection[];
  entries: PortalEntry[];
  preferences: PortalPreferences | null;
  topics: ArticleTopic[];
}

const emptyData: HomeData = {
  announcements: [],
  articles: [],
  collections: [],
  entries: [],
  preferences: null,
  topics: [],
};

export function HomeWorkspace() {
  const [data, setData] = useState<HomeData>(emptyData);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      setIsLoading(true);
      const token = readAccessToken();
      const content = await listPortalContent(
        ["navigation", "tool", "server", "custom_page"],
        token,
      ).catch(() => ({ categories: [] }));
      const [announcements, articles, topics, collections, preferences] = await Promise.all([
        listAnnouncements({ page: 1, pageSize: 3 }, token).then((result) => result.items).catch(() => []),
        (token ? listVisibleArticles(token, { page: 1, pageSize: 4, sort: "popular" }) : listPublicArticles({ page: 1, pageSize: 4, sort: "popular" }))
          .then((result) => result.items)
          .catch(() => []),
        listTopics(token, { page: 1, pageSize: 4 }).then((result) => result.items).catch(() => []),
        token
          ? listVisibleCollections(token, { page: 1, pageSize: 3 }).then((result) => result.items).catch(() => [])
          : Promise.resolve([]),
        token ? getPortalPreferences(token).catch(() => null) : Promise.resolve(null),
      ]);

      if (!active) return;
      setData({
        announcements,
        articles,
        collections,
        entries: content.categories.flatMap((category) => category.entries),
        preferences,
        topics,
      });
      setError(content.categories.length || announcements.length || articles.length ? "" : "暂时无法读取首页内容，请稍后重试。");
      setIsLoading(false);
    }

    void load();
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(AUTH_STATE_CHANGE_EVENT, load);
    };
  }, []);

  const shortcuts = useMemo(() => {
    const preferred = orderedEntries(data.entries, data.preferences?.homeEntryIds ?? []);
    if (preferred.length) return preferred.slice(0, 8);
    const featured = [...data.entries]
      .filter((entry) => entry.isFeatured)
      .sort((left, right) => left.featuredSortOrder - right.featuredSortOrder || left.id - right.id)
      .slice(0, 8);
    return featured.length ? featured : data.entries.slice(0, 8);
  }, [data.entries, data.preferences]);

  return (
    <section className="p8-page p8-home-page">
      <header className="p8-page-heading">
        <div>
          <span className="section-label">HOME</span>
          <h1>首页</h1>
        </div>
        <nav aria-label="首页快捷入口" className="p8-heading-actions">
          <Link href="/articles"><BookOpenText aria-hidden="true" size={16} />文章</Link>
          <Link href="/tools"><Wrench aria-hidden="true" size={16} />工具</Link>
          <Link href="/dashboard"><LayoutGrid aria-hidden="true" size={16} />工作台</Link>
        </nav>
      </header>

      {isLoading ? <div className="status-row compact-status-row"><span className="status">正在整理首页</span></div> : (
        <div className="p8-home-layout">
          <div className="p8-home-main">
            <section className="p8-surface p8-announcement-panel">
              <div className="p8-section-heading">
                <div><Bell aria-hidden="true" size={17} /><h2>站点公告</h2></div>
                <Link href="/announcements">全部公告<ArrowRight aria-hidden="true" size={14} /></Link>
              </div>
              {data.announcements.length ? <div className="p8-announcement-list">
                {data.announcements.map((item) => <Link href={`/announcements/${item.id}`} key={item.id}>
                  <span>{formatDate(item.publishedAt ?? item.createdAt)}</span>
                  <strong>{item.title}</strong>
                  <small>{item.summary || "查看公告详情"}</small>
                </Link>)}
              </div> : <P8Empty text="暂时没有可见公告。" />}
            </section>

            <section className="p8-surface p8-article-panel">
              <div className="p8-section-heading">
                <div><Compass aria-hidden="true" size={17} /><h2>热门内容</h2></div>
                <Link href="/articles">发现更多<ArrowRight aria-hidden="true" size={14} /></Link>
              </div>
              {data.articles.length ? <div className="p8-article-list">
                {data.articles.map((article) => <Link href={`/articles/${article.slug}`} key={article.id}>
                  <span className="p8-article-order">{article.isPinned ? "置顶" : String(article.viewCount)}</span>
                  <span className="p8-article-copy"><strong style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</strong><small>{article.summary || article.category || "阅读文章详情"}</small></span>
                  <span className="p8-article-meta">{article.likeCount} 赞 · {article.commentCount} 回复</span>
                </Link>)}
              </div> : <P8Empty text="暂时没有可展示的文章。" />}
            </section>
          </div>

          <aside className="p8-home-side">
            <section className="p8-surface p8-shortcuts-panel">
              <div className="p8-section-heading">
                <div><Wrench aria-hidden="true" size={17} /><h2>快捷入口</h2></div>
                <Link href="/tools">管理<ArrowRight aria-hidden="true" size={14} /></Link>
              </div>
              {shortcuts.length ? <div className="p8-shortcut-grid">
                {shortcuts.map((entry) => <PortalShortcut entry={entry} key={entry.id} />)}
              </div> : <P8Empty text="管理员尚未设置推荐入口。" />}
            </section>

            <section className="p8-surface p8-discovery-panel">
              <div className="p8-section-heading"><div><Compass aria-hidden="true" size={17} /><h2>专题</h2></div><Link href="/topics">查看全部<ArrowRight aria-hidden="true" size={14} /></Link></div>
              {data.topics.length ? <div className="p8-discovery-list">{data.topics.slice(0, 3).map((topic) => <Link href={`/topics/${topic.slug}`} key={topic.id}><span>{topic.coverPath ? <img alt="" src={topic.coverPath} /> : <Compass aria-hidden="true" size={16} />}</span><strong>{topic.title}</strong><small>{topic.articleCount} 篇</small></Link>)}</div> : <P8Empty text="暂无可见专题。" />}
              {data.collections.length ? <><div className="p8-subsection-label"><FolderOpen aria-hidden="true" size={14} />合集</div><div className="p8-collection-list">{data.collections.map((collection) => <Link href={`/collections/${collection.id}`} key={collection.id}><strong>{collection.name}</strong><small>{collection.articleCount} 篇 · {collection.owner.nickname}</small></Link>)}</div></> : null}
            </section>
          </aside>
        </div>
      )}
      <AppToast message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}

function PortalShortcut({ entry }: { entry: PortalEntry }) {
  const content = <><PortalEntryVisual entry={entry} /><span><strong>{entry.title}</strong><small>{entry.description || portalHost(entry.url)}</small></span></>;
  return entry.url ? <a href={entry.url} rel={entry.openInNewTab ? "noreferrer" : undefined} target={entry.openInNewTab ? "_blank" : undefined}>{content}</a> : <div className="muted">{content}</div>;
}

function P8Empty({ text }: { text: string }) {
  return <p className="p8-empty">{text}</p>;
}

function orderedEntries(entries: PortalEntry[], ids: number[]) {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  return ids.flatMap((id) => {
    const entry = entryById.get(id);
    return entry ? [entry] : [];
  });
}

function portalHost(url: string | null) {
  if (!url) return "暂未配置链接";
  if (url.startsWith("/")) return "站内入口";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "链接入口"; }
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}
