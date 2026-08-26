"use client";

/* eslint-disable @next/next/no-img-element */

import { Bell, BookOpen, Clock3, Coins, Compass, ExternalLink, FileText, Flame, FolderOpen, Search, Trash2, UserRound, UsersRound, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { RoleSymbol } from "@/components/role-symbol";
import { AvatarManagementBadge } from "@/components/user-identity-badges";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { clearSearchHistory, deleteSearchHistory, globalSearch, GlobalSearchResult, HotSearchItem, listHotSearches, listSearchHistory, recordSearch, SearchCategoryFilter, SearchHistoryItem, SearchSort } from "@/lib/search-api";
import { listResourceCatalog, listTopics, type ArticleTopic, type ResourceCatalogItem } from "@/lib/discovery-api";
import { getAvatarFallbackText } from "@/lib/user-display";
import { formatDate, localizedPath } from "@/lib/i18n";

type SearchTab = "all" | "articles" | "users" | "navigation" | "tools" | "topics" | "collections" | "groups" | "announcements";

export default function SearchPage() {
  return <Suspense><SearchContent /></Suspense>;
}

function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const activeTab = normalizeTab(searchParams.get("tab"));
  const category = searchParams.get("category") ?? "";
  const sort = normalizeSort(searchParams.get("sort"));
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  return <SearchResults activeTab={activeTab} category={category} key={`${query}-${activeTab}-${category}-${sort}`} page={page} query={query} sort={sort} />;
}

function SearchResults({ activeTab, category, page, query, sort }: { activeTab: SearchTab; category: string; page: number; query: string; sort: SearchSort }) {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [draft, setDraft] = useState(query);
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(query));
  const [error, setError] = useState("");
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [hot, setHot] = useState<HotSearchItem[]>([]);

  useEffect(() => {
    if (!query) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      setError("");
      globalSearch(query, {
        accessToken: readAccessToken(),
        page: activeTab === "all" ? 1 : page,
        pageSize: activeTab === "all" ? 6 : 12,
        scope: activeTab,
        category: category || undefined,
        sort,
      })
        .then((next) => { if (active) setResult(next); })
        .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : phrase("搜索失败。", "Search failed.")); })
        .finally(() => { if (active) setIsLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [activeTab, category, page, phrase, query, sort]);

  useEffect(() => {
    if (query) return;
    const token = readAccessToken();
    Promise.all([
      listHotSearches(12).catch(() => ({ items: [] })),
      token ? listSearchHistory(token).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
    ]).then(([hotResult, historyResult]) => {
      setHot(hotResult.items);
      setHistory(historyResult.items);
    });
  }, [query]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = draft.trim();
    if (!keyword) return;
    openSearch(keyword);
  }

  function openSearch(keyword: string) {
    const token = readAccessToken();
    if (token) void recordSearch(token, keyword).catch(() => undefined);
    router.push(`${localizedPath("/search", locale)}?q=${encodeURIComponent(keyword)}&tab=${activeTab}&sort=${sort}`);
  }

  function navigate(next: { tab?: SearchTab; category?: string; page?: number; sort?: SearchSort }) {
    const tab = next.tab ?? activeTab;
    const nextCategory = next.category ?? (next.tab && next.tab !== activeTab ? "" : category);
    const params = new URLSearchParams({ q: query, tab });
    params.set("sort", next.sort ?? sort);
    if (nextCategory) params.set("category", nextCategory);
    if ((next.page ?? 1) > 1) params.set("page", String(next.page));
    router.replace(`${localizedPath("/search", locale)}?${params}`);
  }

  async function removeHistory(id: number) {
    const token = readAccessToken();
    if (!token) return;
    await deleteSearchHistory(token, id).catch(() => undefined);
    setHistory((current) => current.filter((item) => item.id !== id));
  }

  async function clearHistory() {
    const token = readAccessToken();
    if (!token) return;
    await clearSearchHistory(token).catch(() => undefined);
    setHistory([]);
  }

  const totalPages = activeTab === "articles" ? result?.articles.totalPages ?? 1
    : activeTab === "users" ? result?.users.totalPages ?? 1
      : activeTab === "navigation" ? result?.navigation.totalPages ?? 1
        : activeTab === "tools" ? result?.tools.totalPages ?? 1
          : activeTab === "topics" ? result?.topics.totalPages ?? 1
            : activeTab === "collections" ? result?.collections.totalPages ?? 1
              : activeTab === "groups" ? result?.groups.totalPages ?? 1
                : activeTab === "announcements" ? result?.announcements.totalPages ?? 1 : 1;
  const filters = activeTab === "articles" ? result?.filters.articleCategories ?? []
    : activeTab === "navigation" ? result?.filters.navigationCategories ?? []
      : activeTab === "tools" ? result?.filters.toolCategories ?? [] : [];
  const total = (result?.articles.total ?? 0) + (result?.users.total ?? 0) + (result?.navigation.total ?? 0) + (result?.tools.total ?? 0) + (result?.topics.total ?? 0) + (result?.collections.total ?? 0) + (result?.groups.total ?? 0) + (result?.announcements.total ?? 0);

  return <section className="page-shell search-page">
    <form className="search-page-field" onSubmit={submit}><Search aria-hidden="true" size={21} /><input aria-label={phrase("全站搜索", "Site search")} autoFocus onChange={(event) => setDraft(event.target.value)} placeholder={phrase("搜索文章、用户、导航、工具、专题、合集、群聊和公告", "Search articles, users, navigation, tools, topics, collections, groups, and announcements")} value={draft} />{draft ? <button aria-label={phrase("清空", "Clear")} onClick={() => setDraft("")} type="button"><X aria-hidden="true" size={17} /></button> : null}</form>
    {query ? <nav className="search-tabs"><SearchTabButton active={activeTab === "all"} count={total} label={phrase("全部", "All")} onClick={() => navigate({ tab: "all" })} /><SearchTabButton active={activeTab === "articles"} count={result?.articles.total ?? 0} label={phrase("文章", "Articles")} onClick={() => navigate({ tab: "articles" })} /><SearchTabButton active={activeTab === "users"} count={result?.users.total ?? 0} label={phrase("用户", "Users")} onClick={() => navigate({ tab: "users" })} /><SearchTabButton active={activeTab === "navigation"} count={result?.navigation.total ?? 0} label={phrase("导航", "Navigation")} onClick={() => navigate({ tab: "navigation" })} /><SearchTabButton active={activeTab === "tools"} count={result?.tools.total ?? 0} label={phrase("工具", "Tools")} onClick={() => navigate({ tab: "tools" })} /><SearchTabButton active={activeTab === "topics"} count={result?.topics.total ?? 0} label={phrase("专题", "Topics")} onClick={() => navigate({ tab: "topics" })} /><SearchTabButton active={activeTab === "collections"} count={result?.collections.total ?? 0} label={phrase("合集", "Collections")} onClick={() => navigate({ tab: "collections" })} /><SearchTabButton active={activeTab === "groups"} count={result?.groups.total ?? 0} label={phrase("群聊", "Groups")} onClick={() => navigate({ tab: "groups" })} /><SearchTabButton active={activeTab === "announcements"} count={result?.announcements.total ?? 0} label={phrase("公告", "Announcements")} onClick={() => navigate({ tab: "announcements" })} /></nav> : null}
    {filters.length ? <SearchFilters active={category} allLabel={phrase("全部分类", "All categories")} items={filters} onChange={(value) => navigate({ category: value, page: 1 })} /> : null}
    {query ? <div className="search-sort-row"><span>{phrase("排序", "Sort")}</span><div><button className={sort === "relevance" ? "active" : undefined} onClick={() => navigate({ sort: "relevance", page: 1 })} type="button">{phrase("综合", "Relevance")}</button><button className={sort === "latest" ? "active" : undefined} onClick={() => navigate({ sort: "latest", page: 1 })} type="button">{phrase("最新", "Newest")}</button><button className={sort === "popular" ? "active" : undefined} onClick={() => navigate({ sort: "popular", page: 1 })} type="button">{phrase("热门", "Popular")}</button></div></div> : null}
    {isLoading ? <div className="search-page-empty">{phrase("正在搜索。", "Searching.")}</div> : null}
    {!isLoading && !query ? <div className="search-page-start">{history.length ? <section><header><span><Clock3 aria-hidden="true" size={16} /><strong>{phrase("最近搜索", "Recent searches")}</strong></span><button onClick={() => void clearHistory()} type="button"><Trash2 aria-hidden="true" size={14} />{phrase("清空", "Clear")}</button></header><div>{history.map((item) => <span key={item.id}><button onClick={() => openSearch(item.keyword)} type="button">{item.keyword}</button><button aria-label={phrase(`删除搜索记录 ${item.keyword}`, `Delete search ${item.keyword}`)} onClick={() => void removeHistory(item.id)} title={phrase("删除", "Delete")} type="button"><X aria-hidden="true" size={13} /></button></span>)}</div></section> : null}{hot.length ? <section><header><span><Flame aria-hidden="true" size={16} /><strong>{phrase("热门搜索", "Trending searches")}</strong></span></header><div>{hot.map((item, index) => <button key={item.keyword} onClick={() => openSearch(item.keyword)} type="button"><b>{index + 1}</b><span>{item.keyword}</span><small>{phrase(`${item.searchCount} 次`, `${item.searchCount} searches`)}</small></button>)}</div></section> : null}{!history.length && !hot.length ? <div className="search-page-empty"><Search aria-hidden="true" size={28} /><strong>{phrase("搜索 HLOVET", "Search HLOVET")}</strong><span>{phrase("文章、公开用户资料、导航和工具会集中展示。", "Articles, public profiles, navigation, and tools appear together here.")}</span></div> : null}</div> : null}
    {!isLoading && result ? <div className="search-page-results">
      {(activeTab === "all" || activeTab === "articles") && result.articles.total ? <SearchResultSection count={result.articles.total} icon={FileText} resultLabel={phrase("条结果", "results")} title={phrase("文章", "Articles")}><div className="search-article-list">{result.articles.items.map((article) => <Link className="search-article-row" href={localizedPath(`/articles/${article.slug}`, locale)} key={article.id}><span><strong>{article.title}</strong><small>{article.author.nickname} · {article.category || phrase("随笔", "Notes")} · {formatTime(article.publishedAt, locale)}</small></span><span>{article.tags.slice(0, 3).map((tag) => <em key={tag}>#{tag}</em>)}</span><b>{phrase(`${article.viewCount} 阅读 · ${article.commentCount} 评论`, `${article.viewCount} views · ${article.commentCount} comments`)}</b></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "users") && result.users.total ? <SearchResultSection count={result.users.total} icon={UserRound} resultLabel={phrase("条结果", "results")} title={phrase("用户", "Users")}><div className="search-user-grid">{result.users.items.map((user) => <Link href={localizedPath(`/users/${encodeURIComponent(user.username)}`, locale)} key={user.id}><span className="search-user-avatar identity-avatar-host"><span className="identity-avatar-visual">{user.avatarUrl ? <img alt="" src={resolveApiUrl(user.avatarUrl)} /> : getAvatarFallbackText(user)}</span><AvatarManagementBadge user={user} /></span><span><strong>{user.nickname}</strong><small>@{user.username}</small><p>{user.profileBio}</p></span><RoleSymbol code={user.role.code} /></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "navigation") && result.navigation.total ? <EntrySection count={result.navigation.total} emptyDescription={phrase("暂无说明", "No description yet")} entries={result.navigation.items} icon={Compass} resultLabel={phrase("条结果", "results")} title={phrase("导航", "Navigation")} /> : null}
      {(activeTab === "all" || activeTab === "tools") && result.tools.total ? <EntrySection count={result.tools.total} emptyDescription={phrase("暂无说明", "No description yet")} entries={result.tools.items} icon={Wrench} resultLabel={phrase("条结果", "results")} title={phrase("工具", "Tools")} /> : null}
      {(activeTab === "all" || activeTab === "topics") && result.topics.total ? <SearchResultSection count={result.topics.total} icon={BookOpen} resultLabel={phrase("条结果", "results")} title={phrase("专题", "Topics")}><div className="search-discovery-grid">{result.topics.items.map((topic) => <Link className="search-discovery-row" href={localizedPath(`/topics/${topic.slug}`, locale)} key={topic.id}><span className="search-discovery-icon">{topic.coverPath ? <img alt="" src={resolveApiUrl(topic.coverPath)} /> : <BookOpen aria-hidden="true" size={20} />}</span><span><strong>{topic.title}</strong><small>{phrase(`${topic.articleCount} 篇文章 · ${topic.subscriberCount} 人订阅 · ${formatTime(topic.updatedAt, locale)}`, `${topic.articleCount} articles · ${topic.subscriberCount} subscribers · ${formatTime(topic.updatedAt, locale)}`)}</small><p>{topic.description || phrase("暂无专题说明", "No topic description yet")}</p></span></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "collections") && result.collections.total ? <SearchResultSection count={result.collections.total} icon={FolderOpen} resultLabel={phrase("条结果", "results")} title={phrase("合集", "Collections")}><div className="search-discovery-grid">{result.collections.items.map((collection) => <Link className="search-discovery-row" href={localizedPath(`/collections/${collection.id}`, locale)} key={collection.id}><span className="search-discovery-icon"><FolderOpen aria-hidden="true" size={20} /></span><span><strong>{collection.name}</strong><small>{phrase(`${collection.articleCount} 篇文章 · ${collection.subscriberCount} 人订阅 · ${collection.owner.nickname}`, `${collection.articleCount} articles · ${collection.subscriberCount} subscribers · ${collection.owner.nickname}`)}</small><p>{collection.description || phrase("暂无合集说明", "No collection description yet")}</p></span></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "groups") && result.groups.total ? <SearchResultSection count={result.groups.total} icon={UsersRound} resultLabel={phrase("条结果", "results")} title={phrase("群聊", "Groups")}><div className="search-discovery-grid">{result.groups.items.map((group) => <Link className="search-discovery-row" href={`${localizedPath("/messages", locale)}?conversation=${group.conversationId}`} key={group.id}><span className="search-discovery-icon group">{group.avatarUrl ? <img alt="" src={resolveApiUrl(group.avatarUrl)} /> : <UsersRound aria-hidden="true" size={20} />}</span><span><strong>{group.name}</strong><small>{phrase(`${group.memberCount} 位成员 · ${group.isMember ? "已加入" : group.joinMode === "approval" ? "可申请加入" : "仅限邀请"} · ${formatTime(group.updatedAt, locale)}`, `${group.memberCount} members · ${group.isMember ? "Joined" : group.joinMode === "approval" ? "Request to join" : "Invitation only"} · ${formatTime(group.updatedAt, locale)}`)}</small><p>{group.announcement || phrase("暂无群公告", "No group announcement yet")}</p></span></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "announcements") && result.announcements.total ? <SearchResultSection count={result.announcements.total} icon={Bell} resultLabel={phrase("条结果", "results")} title={phrase("站点公告", "Site announcements")}><div className="search-article-list">{result.announcements.items.map((announcement) => <Link className="search-article-row" href={localizedPath(`/announcements/${announcement.id}`, locale)} key={announcement.id}><span><strong>{announcement.title}</strong><small>{announcement.summary || phrase("打开查看公告详情", "Open to view announcement details")} · {formatTime(announcement.publishedAt, locale)}</small></span><b>{announcement.isPinned ? phrase("置顶", "Pinned") : ""}</b></Link>)}</div></SearchResultSection> : null}
      {!total ? <SearchDiscoveryFallback accessToken={readAccessToken()} locale={locale} onSearch={openSearch} phrase={phrase} /> : null}
    </div> : null}
    {result && totalPages > 1 ? <nav aria-label={phrase("搜索结果分页", "Search results pagination")} className="admin-pagination search-pagination"><span>{phrase(`第 ${page} / ${totalPages} 页`, `Page ${page} of ${totalPages}`)}</span><div><button disabled={page <= 1} onClick={() => navigate({ page: page - 1 })} type="button">{phrase("上一页", "Previous")}</button><button disabled={page >= totalPages} onClick={() => navigate({ page: page + 1 })} type="button">{phrase("下一页", "Next")}</button></div></nav> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function SearchDiscoveryFallback({
  accessToken,
  locale,
  onSearch,
  phrase,
}: {
  accessToken: string | null;
  locale: "zh-CN" | "en-US";
  onSearch: (keyword: string) => void;
  phrase: (chinese: string, english: string) => string;
}) {
  const [hot, setHot] = useState<HotSearchItem[]>([]);
  const [topics, setTopics] = useState<ArticleTopic[]>([]);
  const [resources, setResources] = useState<ResourceCatalogItem[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([
      listHotSearches(6).catch(() => ({ items: [] })),
      listTopics(accessToken, { pageSize: 4 }).catch(() => ({ items: [], total: 0, page: 1, pageSize: 4, totalPages: 1 })),
      listResourceCatalog(accessToken, { pageSize: 3, sort: "popular" }).catch(() => ({ items: [], total: 0, page: 1, pageSize: 3, totalPages: 1 })),
    ]).then(([hotResult, topicResult, resourceResult]) => {
      if (!active) return;
      setHot(hotResult.items);
      setTopics(topicResult.items);
      setResources(resourceResult.items);
    });
    return () => { active = false; };
  }, [accessToken]);

  return <div className="search-discovery-fallback">
    <div className="search-page-empty"><strong>{phrase("没有找到匹配内容", "No matching content")}</strong><span>{phrase("可以从热门搜索、专题或积分资源继续浏览。", "Try trending searches, topics, or point resources instead.")}</span></div>
    {hot.length ? <section><header><span><Flame aria-hidden="true" size={16} /><strong>{phrase("热门搜索", "Trending searches")}</strong></span></header><div className="search-fallback-tags">{hot.map((item) => <button key={item.keyword} onClick={() => onSearch(item.keyword)} type="button">{item.keyword}</button>)}</div></section> : null}
    {topics.length ? <section><header><span><BookOpen aria-hidden="true" size={16} /><strong>{phrase("探索专题", "Explore topics")}</strong></span></header><div className="search-fallback-links">{topics.map((topic) => <Link href={localizedPath(`/topics/${topic.slug}`, locale)} key={topic.id}>{topic.title}<small>{phrase(`${topic.articleCount} 篇`, `${topic.articleCount} articles`)}</small></Link>)}</div></section> : null}
    {resources.length ? <section><header><span><Coins aria-hidden="true" size={16} /><strong>{phrase("积分资源", "Point resources")}</strong></span><Link href={localizedPath("/articles/resources", locale)}>{phrase("查看全部", "View all")}</Link></header><div className="search-fallback-links">{resources.map((item) => <Link href={localizedPath(`/articles/${item.article.slug}`, locale)} key={item.article.id}>{item.article.title}<small><Coins aria-hidden="true" size={12} />{item.minimumPointCost}</small></Link>)}</div></section> : null}
  </div>;
}

function EntrySection({ count, emptyDescription, entries, icon, resultLabel, title }: { count: number; emptyDescription: string; entries: GlobalSearchResult["navigation"]["items"]; icon: typeof Search; resultLabel: string; title: string }) {
  const Icon = icon;
  return <SearchResultSection count={count} icon={Icon} resultLabel={resultLabel} title={title}><div className="search-entry-grid">{entries.map((entry) => entry.url ? <a href={entry.url} key={entry.id} rel="noreferrer" target={entry.openInNewTab ? "_blank" : undefined}><span className="search-entry-icon">{entry.iconPath ? <img alt="" src={entry.iconPath} /> : <Icon aria-hidden="true" size={22} />}</span><span><strong>{entry.title}</strong><small>{entry.category.name}</small><p>{entry.description || emptyDescription}</p></span><ExternalLink aria-hidden="true" size={15} /></a> : null)}</div></SearchResultSection>;
}

function SearchFilters({ active, allLabel, items, onChange }: { active: string; allLabel: string; items: SearchCategoryFilter[]; onChange: (value: string) => void }) {
  return <div className="search-category-filters"><button className={!active ? "active" : undefined} onClick={() => onChange("")} type="button">{allLabel}</button>{items.map((item) => <button className={active === item.value ? "active" : undefined} key={item.value} onClick={() => onChange(item.value)} type="button">{item.name}</button>)}</div>;
}

function SearchTabButton({ active, count, label, onClick }: { active: boolean; count: number; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick} type="button"><span>{label}</span><b>{count}</b></button>;
}

function SearchResultSection({ count, icon: Icon, resultLabel, title, children }: { count: number; icon: typeof Search; resultLabel: string; title: string; children: React.ReactNode }) {
  return <section className="search-result-section"><header><span><Icon aria-hidden="true" size={17} /><strong>{title}</strong></span><small>{count} {resultLabel}</small></header>{children}</section>;
}

function normalizeTab(value: string | null): SearchTab {
  return value === "articles" || value === "users" || value === "navigation" || value === "tools" || value === "topics" || value === "collections" || value === "groups" || value === "announcements" ? value : "all";
}

function normalizeSort(value: string | null): SearchSort {
  return value === "latest" || value === "popular" ? value : "relevance";
}

function formatTime(value: string | null, locale: "zh-CN" | "en-US"): string {
  if (!value) return "";
  return formatDate(value, locale, { year: "numeric", month: "2-digit", day: "2-digit" });
}
