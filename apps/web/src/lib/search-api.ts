import { requestJson } from "./auth-api";

export interface SearchUserResult {
  id: number;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  profileBio: string;
  isSuperAdmin: boolean;
  isAdministrator: boolean;
  role: { code: string; name: string; level: number };
  createdAt: string;
}

export interface SearchArticleResult {
  id: number;
  title: string;
  slug: string;
  category: string;
  tags: string[];
  publishedAt: string | null;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  commentCount: number;
  author: Pick<SearchUserResult, "id" | "username" | "nickname" | "avatarUrl" | "isSuperAdmin" | "isAdministrator" | "role">;
}

export interface SearchEntryResult {
  id: number;
  title: string;
  description: string;
  url: string | null;
  iconPath: string | null;
  openInNewTab: boolean;
  category: { id: number; name: string; slug: string; kind: "navigation" | "tool" | "custom_page" };
}

export interface SearchGroup<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface GlobalSearchResult {
  query: string;
  sort: SearchSort;
  articles: SearchGroup<SearchArticleResult>;
  users: SearchGroup<SearchUserResult>;
  navigation: SearchGroup<SearchEntryResult>;
  tools: SearchGroup<SearchEntryResult>;
  filters: {
    articleCategories: SearchCategoryFilter[];
    navigationCategories: SearchCategoryFilter[];
    toolCategories: SearchCategoryFilter[];
  };
}

export type SearchSort = "relevance" | "latest" | "popular";

export interface SearchHistoryItem {
  id: number;
  keyword: string;
  searchCount: number;
  lastSearchedAt: string;
}

export interface HotSearchItem {
  keyword: string;
  searchCount: number;
}

export interface SearchCategoryFilter {
  name: string;
  value: string;
}

export function globalSearch(
  query: string,
  options: {
    accessToken?: string | null;
    page?: number;
    pageSize?: number;
    scope?: "all" | "articles" | "users" | "navigation" | "tools";
    category?: string;
    sort?: SearchSort;
  } = {},
): Promise<GlobalSearchResult> {
  const params = new URLSearchParams({
    q: query,
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 12),
    scope: options.scope ?? "all",
    sort: options.sort ?? "relevance",
  });
  if (options.category) params.set("category", options.category);
  const path = options.accessToken ? "/search/visible" : "/search/public";
  return requestJson<GlobalSearchResult>(`${path}?${params}`, {
    cache: "no-store",
    headers: options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : undefined,
  });
}

export function listSearchHistory(accessToken: string): Promise<{ items: SearchHistoryItem[] }> {
  return requestJson("/search/history", { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } });
}

export function listHotSearches(limit = 10): Promise<{ items: HotSearchItem[] }> {
  return requestJson(`/search/hot?limit=${limit}`, { cache: "no-store" });
}

export function recordSearch(accessToken: string, keyword: string): Promise<{ success: true }> {
  return requestJson("/search/history", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ keyword }),
  });
}

export function deleteSearchHistory(accessToken: string, id: number): Promise<{ success: true }> {
  return requestJson(`/search/history/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function clearSearchHistory(accessToken: string): Promise<{ count: number }> {
  return requestJson("/search/history", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
