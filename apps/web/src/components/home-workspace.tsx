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
  Heart,
  MessageCircleMore,
  Rss,
  Star,
  Users,
  UsersRound,
  Wrench,
} from "lucide-react";
import { AnonymousTopicsPanel } from "@/components/anonymous-topics-panel";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { PortalEntryVisual } from "@/components/portal-entry-visual";
import { SuggestionsPanel } from "@/components/suggestions-panel";
import { listVisibleArticles, listPublicArticles, type Article } from "@/lib/article-api";
import { listAnnouncements, type AnnouncementSummary } from "@/lib/announcements-api";
import { resolveApiUrl } from "@/lib/auth-api";
import { AUTH_STATE_CHANGE_EVENT, readAccessToken } from "@/lib/auth-storage";
import { listTopics, listVisibleCollections, type ArticleCollection, type ArticleTopic } from "@/lib/discovery-api";
import {
  getPortalPreferences,
  getPortalHomeSummary,
  listPortalContent,
  type PortalEntry,
  type PortalHomeSummary,
  type PortalPreferences,
} from "@/lib/portal-api";
import { formatDate as formatLocaleDate, localizedPath } from "@/lib/i18n";

interface HomeData {
  announcements: AnnouncementSummary[];
  articles: Article[];
  collections: ArticleCollection[];
  entries: PortalEntry[];
  preferences: PortalPreferences | null;
  homeSummary: PortalHomeSummary | null;
  topics: ArticleTopic[];
}

const emptyData: HomeData = {
  announcements: [],
  articles: [],
  collections: [],
  entries: [],
  homeSummary: null,
  preferences: null,
  topics: [],
};

export function HomeWorkspace() {
  const { locale, t } = useLanguage();
  const [data, setData] = useState<HomeData>(emptyData);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
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
      const [announcements, articles, topics, collections, preferences, homeSummary] = await Promise.all([
        listAnnouncements({ page: 1, pageSize: 3 }, token).then((result) => result.items).catch(() => []),
        (token ? listVisibleArticles(token, { page: 1, pageSize: 4, sort: "popular" }) : listPublicArticles({ page: 1, pageSize: 4, sort: "popular" }))
          .then((result) => result.items)
          .catch(() => []),
        listTopics(token, { page: 1, pageSize: 4 }).then((result) => result.items).catch(() => []),
        token
          ? listVisibleCollections(token, { page: 1, pageSize: 3 }).then((result) => result.items).catch(() => [])
          : Promise.resolve([]),
        token ? getPortalPreferences(token).catch(() => null) : Promise.resolve(null),
        token ? getPortalHomeSummary(token).catch(() => null) : Promise.resolve(null),
      ]);

      if (!active) return;
      setData({
        announcements,
        articles,
        collections,
        entries: content.categories.flatMap((category) => category.entries),
        homeSummary,
        preferences,
        topics,
      });
      setError(content.categories.length || announcements.length || articles.length ? "" : t("home.loadFailed"));
      setHasLoaded(true);
      setIsLoading(false);
    }

    void load();
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(AUTH_STATE_CHANGE_EVENT, load);
    };
  }, [t]);

  const shortcuts = useMemo(() => {
    const preferred = orderedEntries(data.entries, data.preferences?.homeEntryIds ?? []);
    if (preferred.length) return preferred.slice(0, 12);
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
          {locale === "zh-CN" ? <span className="section-label">{t("home.section")}</span> : null}
          <h1>{t("home.title")}</h1>
        </div>
        <HomeStats locale={locale} summary={data.homeSummary} />
      </header>

      {!hasLoaded ? <div className="status-row compact-status-row"><span className="status">{t("home.organizing")}</span></div> : (
        <div className="p8-home-layout">
          <div className="p8-home-main">
            <section className="p8-surface p8-announcement-panel">
              <div className="p8-section-heading">
                <div><Bell aria-hidden="true" size={17} /><h2>{t("home.siteAnnouncements")}</h2></div>
                <Link href={localizedPath("/announcements", locale)}>{t("home.allAnnouncements")}<ArrowRight aria-hidden="true" size={14} /></Link>
              </div>
              {data.announcements.length ? <div className="p8-announcement-list">
                {data.announcements.map((item) => <Link href={localizedPath(`/announcements/${item.id}`, locale)} key={item.id}>
                  <span>{formatDate(item.publishedAt ?? item.createdAt, locale)}</span>
                  <strong>{item.title}</strong>
                  <small>{item.summary || t("home.viewAnnouncement")}</small>
                </Link>)}
              </div> : <P8Empty text={t("home.noAnnouncements")} />}
            </section>

            <section className="p8-surface p8-article-panel">
              <div className="p8-section-heading">
                <div><Compass aria-hidden="true" size={17} /><h2>{t("home.popularContent")}</h2></div>
                <Link href={localizedPath("/articles", locale)}>{t("home.discoverMore")}<ArrowRight aria-hidden="true" size={14} /></Link>
              </div>
              {data.articles.length ? <div className="p8-article-list">
                {data.articles.map((article) => <Link href={localizedPath(`/articles/${article.slug}`, locale)} key={article.id}>
                  <span className="p8-article-order">{article.isPinned ? t("home.pinned") : String(article.viewCount)}</span>
                  <span className="p8-article-copy"><strong style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</strong><small>{article.summary || article.category || t("home.readArticle")}</small></span>
                  <span className="p8-article-meta">{article.likeCount} {t("home.likes")} · {article.commentCount} {t("home.replies")}</span>
                </Link>)}
              </div> : <P8Empty text={t("home.noArticles")} />}
            </section>
            <AnonymousTopicsPanel initialSort="home" moreHref={localizedPath("/voices", locale)} />
          </div>

          <aside className="p8-home-side">
            <section className="p8-surface p8-shortcuts-panel">
              <div className="p8-section-heading">
                <div><Wrench aria-hidden="true" size={17} /><h2>{t("home.quickEntries")}</h2></div>
                <Link href={localizedPath("/tools", locale)}>{t("home.manage")}<ArrowRight aria-hidden="true" size={14} /></Link>
              </div>
              {shortcuts.length ? <div className="p8-shortcut-grid">
                {shortcuts.map((entry) => <PortalShortcut entry={entry} key={entry.id} />)}
              </div> : <P8Empty text={t("home.noFeaturedEntries")} />}
            </section>
            <SuggestionsPanel moreHref={localizedPath("/suggestions", locale)} />

            <section className="p8-surface p8-discovery-panel">
              <div className="p8-section-heading"><div><Compass aria-hidden="true" size={17} /><h2>{t("home.topic")}</h2></div><Link href={localizedPath("/topics", locale)}>{t("home.viewAll")}<ArrowRight aria-hidden="true" size={14} /></Link></div>
              {data.topics.length ? <div className="p8-discovery-list">{data.topics.slice(0, 3).map((topic) => <Link href={localizedPath(`/topics/${topic.slug}`, locale)} key={topic.id}><span>{topic.coverPath ? <img alt="" src={resolveApiUrl(topic.coverPath)} /> : <Compass aria-hidden="true" size={16} />}</span><strong>{topic.title}</strong><small>{t("home.articleCount", { count: topic.articleCount })}</small></Link>)}</div> : <P8Empty text={t("home.noTopics")} />}
              {data.collections.length ? <><div className="p8-subsection-label"><FolderOpen aria-hidden="true" size={14} />{t("home.collection")}</div><div className="p8-collection-list">{data.collections.map((collection) => <Link href={localizedPath(`/collections/${collection.id}`, locale)} key={collection.id}><strong>{collection.name}</strong><small>{t("home.articleCount", { count: collection.articleCount })} · {collection.owner.nickname}</small></Link>)}</div></> : null}
            </section>
          </aside>
        </div>
      )}
      {hasLoaded && isLoading ? <span aria-live="polite" className="p8-background-refresh">{t("home.refreshing")}</span> : null}
      <AppToast message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}

function HomeStats({ summary, locale }: { summary: PortalHomeSummary | null; locale: "zh-CN" | "en-US" }) {
  const { t } = useLanguage();
  if (!summary) return <Link className="p8-home-login-stat" href={localizedPath("/login", locale)}>{t("home.loginStats")}</Link>;
  const stats = [
    { icon: BookOpenText, label: t("home.articleViews"), value: summary.articleViews },
    { icon: MessageCircleMore, label: t("home.commentCount"), value: summary.commentCount },
    { icon: Rss, label: t("home.subscriberCount"), value: summary.subscriberCount },
    { icon: Heart, label: t("home.likeCount"), value: summary.likeCount },
    { icon: Star, label: t("home.favoriteCount"), value: summary.favoriteCount },
    { icon: Users, label: t("home.friendCount"), value: summary.friendCount },
    { icon: UsersRound, label: t("home.groupCount"), value: summary.groupCount },
  ];
  return <div aria-label={t("home.stats")} className="p8-home-stats">{stats.map(({ icon: Icon, label, value }) => <span key={label} title={`${label} ${value}`}><Icon aria-hidden="true" size={15} /><b>{value}</b><small>{label}</small></span>)}</div>;
}

function PortalShortcut({ entry }: { entry: PortalEntry }) {
  const { phrase } = useLanguage();
  const content = <><PortalEntryVisual entry={entry} /><span><strong>{entry.title}</strong><small>{entry.description || portalHost(entry.url, phrase)}</small></span></>;
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

function portalHost(url: string | null, phrase: (chinese: string, english: string) => string) {
  if (!url) return phrase("暂未配置链接", "Link not configured");
  if (url.startsWith("/")) return phrase("站内入口", "Internal page");
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return phrase("链接入口", "Link entry"); }
}

function formatDate(value: string, locale: "zh-CN" | "en-US") {
  return formatLocaleDate(value, locale, { month: "2-digit", day: "2-digit" });
}
