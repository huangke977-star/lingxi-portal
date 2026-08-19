"use client";

/* eslint-disable @next/next/no-img-element */

import { Bell, BookOpen, Clock3, Compass, ExternalLink, FileText, Flame, FolderOpen, Search, Trash2, UserRound, UsersRound, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { RoleSymbol } from "@/components/role-symbol";
import { AvatarManagementBadge } from "@/components/user-identity-badges";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { clearSearchHistory, deleteSearchHistory, globalSearch, GlobalSearchResult, HotSearchItem, listHotSearches, listSearchHistory, recordSearch, SearchCategoryFilter, SearchHistoryItem, SearchSort } from "@/lib/search-api";
import { getAvatarFallbackText } from "@/lib/user-display";

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
        .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "搜索失败。"); })
        .finally(() => { if (active) setIsLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [activeTab, category, page, query, sort]);

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
    router.push(`/search?q=${encodeURIComponent(keyword)}&tab=${activeTab}&sort=${sort}`);
  }

  function navigate(next: { tab?: SearchTab; category?: string; page?: number; sort?: SearchSort }) {
    const tab = next.tab ?? activeTab;
    const nextCategory = next.category ?? (next.tab && next.tab !== activeTab ? "" : category);
    const params = new URLSearchParams({ q: query, tab });
    params.set("sort", next.sort ?? sort);
    if (nextCategory) params.set("category", nextCategory);
    if ((next.page ?? 1) > 1) params.set("page", String(next.page));
    router.replace(`/search?${params}`);
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
    <form className="search-page-field" onSubmit={submit}><Search aria-hidden="true" size={21} /><input aria-label="全站搜索" autoFocus onChange={(event) => setDraft(event.target.value)} placeholder="搜索文章、用户、导航、工具、专题、合集、群聊和公告" value={draft} />{draft ? <button aria-label="清空" onClick={() => setDraft("")} type="button"><X aria-hidden="true" size={17} /></button> : null}</form>
    {query ? <nav className="search-tabs"><SearchTabButton active={activeTab === "all"} count={total} label="全部" onClick={() => navigate({ tab: "all" })} /><SearchTabButton active={activeTab === "articles"} count={result?.articles.total ?? 0} label="文章" onClick={() => navigate({ tab: "articles" })} /><SearchTabButton active={activeTab === "users"} count={result?.users.total ?? 0} label="用户" onClick={() => navigate({ tab: "users" })} /><SearchTabButton active={activeTab === "navigation"} count={result?.navigation.total ?? 0} label="导航" onClick={() => navigate({ tab: "navigation" })} /><SearchTabButton active={activeTab === "tools"} count={result?.tools.total ?? 0} label="工具" onClick={() => navigate({ tab: "tools" })} /><SearchTabButton active={activeTab === "topics"} count={result?.topics.total ?? 0} label="专题" onClick={() => navigate({ tab: "topics" })} /><SearchTabButton active={activeTab === "collections"} count={result?.collections.total ?? 0} label="合集" onClick={() => navigate({ tab: "collections" })} /><SearchTabButton active={activeTab === "groups"} count={result?.groups.total ?? 0} label="群聊" onClick={() => navigate({ tab: "groups" })} /><SearchTabButton active={activeTab === "announcements"} count={result?.announcements.total ?? 0} label="公告" onClick={() => navigate({ tab: "announcements" })} /></nav> : null}
    {filters.length ? <SearchFilters active={category} items={filters} onChange={(value) => navigate({ category: value, page: 1 })} /> : null}
    {query ? <div className="search-sort-row"><span>排序</span><div><button className={sort === "relevance" ? "active" : undefined} onClick={() => navigate({ sort: "relevance", page: 1 })} type="button">综合</button><button className={sort === "latest" ? "active" : undefined} onClick={() => navigate({ sort: "latest", page: 1 })} type="button">最新</button><button className={sort === "popular" ? "active" : undefined} onClick={() => navigate({ sort: "popular", page: 1 })} type="button">热门</button></div></div> : null}
    {isLoading ? <div className="search-page-empty">正在搜索。</div> : null}
    {!isLoading && !query ? <div className="search-page-start">{history.length ? <section><header><span><Clock3 aria-hidden="true" size={16} /><strong>最近搜索</strong></span><button onClick={() => void clearHistory()} type="button"><Trash2 aria-hidden="true" size={14} />清空</button></header><div>{history.map((item) => <span key={item.id}><button onClick={() => openSearch(item.keyword)} type="button">{item.keyword}</button><button aria-label={`删除搜索记录 ${item.keyword}`} onClick={() => void removeHistory(item.id)} title="删除" type="button"><X aria-hidden="true" size={13} /></button></span>)}</div></section> : null}{hot.length ? <section><header><span><Flame aria-hidden="true" size={16} /><strong>热门搜索</strong></span></header><div>{hot.map((item, index) => <button key={item.keyword} onClick={() => openSearch(item.keyword)} type="button"><b>{index + 1}</b><span>{item.keyword}</span><small>{item.searchCount} 次</small></button>)}</div></section> : null}{!history.length && !hot.length ? <div className="search-page-empty"><Search aria-hidden="true" size={28} /><strong>搜索 HLOVET</strong><span>文章、公开用户资料、导航和工具会集中展示。</span></div> : null}</div> : null}
    {!isLoading && result ? <div className="search-page-results">
      {(activeTab === "all" || activeTab === "articles") && result.articles.total ? <SearchResultSection count={result.articles.total} icon={FileText} title="文章"><div className="search-article-list">{result.articles.items.map((article) => <Link className="search-article-row" href={`/articles/${article.slug}`} key={article.id}><span><strong>{article.title}</strong><small>{article.author.nickname} · {article.category || "随笔"} · {formatTime(article.publishedAt)}</small></span><span>{article.tags.slice(0, 3).map((tag) => <em key={tag}>#{tag}</em>)}</span><b>{article.viewCount} 阅读 · {article.commentCount} 评论</b></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "users") && result.users.total ? <SearchResultSection count={result.users.total} icon={UserRound} title="用户"><div className="search-user-grid">{result.users.items.map((user) => <Link href={`/users/${encodeURIComponent(user.username)}`} key={user.id}><span className="search-user-avatar identity-avatar-host"><span className="identity-avatar-visual">{user.avatarUrl ? <img alt="" src={resolveApiUrl(user.avatarUrl)} /> : getAvatarFallbackText(user)}</span><AvatarManagementBadge user={user} /></span><span><strong>{user.nickname}</strong><small>@{user.username}</small><p>{user.profileBio}</p></span><RoleSymbol code={user.role.code} /></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "navigation") && result.navigation.total ? <EntrySection count={result.navigation.total} entries={result.navigation.items} icon={Compass} title="导航" /> : null}
      {(activeTab === "all" || activeTab === "tools") && result.tools.total ? <EntrySection count={result.tools.total} entries={result.tools.items} icon={Wrench} title="工具" /> : null}
      {(activeTab === "all" || activeTab === "topics") && result.topics.total ? <SearchResultSection count={result.topics.total} icon={BookOpen} title="专题"><div className="search-discovery-grid">{result.topics.items.map((topic) => <Link className="search-discovery-row" href={`/topics/${topic.slug}`} key={topic.id}><span className="search-discovery-icon">{topic.coverPath ? <img alt="" src={resolveApiUrl(topic.coverPath)} /> : <BookOpen aria-hidden="true" size={20} />}</span><span><strong>{topic.title}</strong><small>{topic.articleCount} 篇文章 · {topic.subscriberCount} 人订阅 · {formatTime(topic.updatedAt)}</small><p>{topic.description || "暂无专题说明"}</p></span></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "collections") && result.collections.total ? <SearchResultSection count={result.collections.total} icon={FolderOpen} title="合集"><div className="search-discovery-grid">{result.collections.items.map((collection) => <Link className="search-discovery-row" href={`/collections/${collection.id}`} key={collection.id}><span className="search-discovery-icon"><FolderOpen aria-hidden="true" size={20} /></span><span><strong>{collection.name}</strong><small>{collection.articleCount} 篇文章 · {collection.subscriberCount} 人订阅 · {collection.owner.nickname}</small><p>{collection.description || "暂无合集说明"}</p></span></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "groups") && result.groups.total ? <SearchResultSection count={result.groups.total} icon={UsersRound} title="群聊"><div className="search-discovery-grid">{result.groups.items.map((group) => <Link className="search-discovery-row" href={`/messages?conversation=${group.conversationId}`} key={group.id}><span className="search-discovery-icon group">{group.avatarUrl ? <img alt="" src={resolveApiUrl(group.avatarUrl)} /> : <UsersRound aria-hidden="true" size={20} />}</span><span><strong>{group.name}</strong><small>{group.memberCount} 位成员 · {group.isMember ? "已加入" : group.joinMode === "approval" ? "可申请加入" : "仅限邀请"} · {formatTime(group.updatedAt)}</small><p>{group.announcement || "暂无群公告"}</p></span></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "announcements") && result.announcements.total ? <SearchResultSection count={result.announcements.total} icon={Bell} title="站点公告"><div className="search-article-list">{result.announcements.items.map((announcement) => <Link className="search-article-row" href={`/announcements/${announcement.id}`} key={announcement.id}><span><strong>{announcement.title}</strong><small>{announcement.summary || "打开查看公告详情"} · {formatTime(announcement.publishedAt)}</small></span><b>{announcement.isPinned ? "置顶" : ""}</b></Link>)}</div></SearchResultSection> : null}
      {!total ? <div className="search-page-empty"><strong>没有找到匹配内容</strong><span>换一个关键词或分类再试试。</span></div> : null}
    </div> : null}
    {result && totalPages > 1 ? <nav className="admin-pagination search-pagination" aria-label="搜索结果分页"><span>第 {page} / {totalPages} 页</span><div><button disabled={page <= 1} onClick={() => navigate({ page: page - 1 })} type="button">上一页</button><button disabled={page >= totalPages} onClick={() => navigate({ page: page + 1 })} type="button">下一页</button></div></nav> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function EntrySection({ count, entries, icon, title }: { count: number; entries: GlobalSearchResult["navigation"]["items"]; icon: typeof Search; title: string }) {
  const Icon = icon;
  return <SearchResultSection count={count} icon={Icon} title={title}><div className="search-entry-grid">{entries.map((entry) => entry.url ? <a href={entry.url} key={entry.id} rel="noreferrer" target={entry.openInNewTab ? "_blank" : undefined}><span className="search-entry-icon">{entry.iconPath ? <img alt="" src={entry.iconPath} /> : <Icon aria-hidden="true" size={22} />}</span><span><strong>{entry.title}</strong><small>{entry.category.name}</small><p>{entry.description || "暂无说明"}</p></span><ExternalLink aria-hidden="true" size={15} /></a> : null)}</div></SearchResultSection>;
}

function SearchFilters({ active, items, onChange }: { active: string; items: SearchCategoryFilter[]; onChange: (value: string) => void }) {
  return <div className="search-category-filters"><button className={!active ? "active" : undefined} onClick={() => onChange("")} type="button">全部分类</button>{items.map((item) => <button className={active === item.value ? "active" : undefined} key={item.value} onClick={() => onChange(item.value)} type="button">{item.name}</button>)}</div>;
}

function SearchTabButton({ active, count, label, onClick }: { active: boolean; count: number; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick} type="button"><span>{label}</span><b>{count}</b></button>;
}

function SearchResultSection({ count, icon: Icon, title, children }: { count: number; icon: typeof Search; title: string; children: React.ReactNode }) {
  return <section className="search-result-section"><header><span><Icon aria-hidden="true" size={17} /><strong>{title}</strong></span><small>{count} 条结果</small></header>{children}</section>;
}

function normalizeTab(value: string | null): SearchTab {
  return value === "articles" || value === "users" || value === "navigation" || value === "tools" || value === "topics" || value === "collections" || value === "groups" || value === "announcements" ? value : "all";
}

function normalizeSort(value: string | null): SearchSort {
  return value === "latest" || value === "popular" ? value : "relevance";
}

function formatTime(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
