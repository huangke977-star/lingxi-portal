import { requestJson } from "./auth-api";

export interface SearchUserResult {
  id: number;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  profileBio: string;
  isSuperAdmin: boolean;
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
  author: Pick<SearchUserResult, "id" | "username" | "nickname" | "avatarUrl" | "isSuperAdmin" | "role">;
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
  articles: SearchGroup<SearchArticleResult>;
  users: SearchGroup<SearchUserResult>;
  entries: SearchGroup<SearchEntryResult>;
}

export function globalSearch(
  query: string,
  options: { accessToken?: string | null; page?: number; pageSize?: number } = {},
): Promise<GlobalSearchResult> {
  const params = new URLSearchParams({
    q: query,
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 12),
  });
  const path = options.accessToken ? "/search/visible" : "/search/public";
  return requestJson<GlobalSearchResult>(`${path}?${params}`, {
    cache: "no-store",
    headers: options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : undefined,
  });
}
