import { requestJson } from "./auth-api";

export type ArticleStatus = "draft" | "published" | "unpublished" | "blocked" | "deleted";
export type ArticleVisibility = "public" | "authenticated" | "role_restricted" | "private";
export type ArticleCommentStatus = "active" | "blocked" | "deleted";

export interface ArticleAuthor {
  id: number;
  nickname: string;
  username: string;
  avatarUrl: string | null;
}

export interface ArticleRole {
  code: string;
  name: string;
  level: number;
}

export interface Article {
  id: number;
  title: string;
  slug: string;
  summary: string;
  content: string;
  coverPath: string | null;
  category: string;
  tags: string[];
  titleColor: string;
  visibility: ArticleVisibility;
  status: ArticleStatus;
  isPinned: boolean;
  pinOrder: number;
  publishedAt: string | null;
  blockedReason: string | null;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  commentCount: number;
  author: ArticleAuthor;
  allowedRoles: ArticleRole[];
  images: string[];
  liked: boolean;
  favorited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleComment {
  id: number;
  articleId: number;
  parentId: number | null;
  body: string;
  status: ArticleCommentStatus;
  author: ArticleAuthor;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleList {
  items: Article[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ArticleInput {
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string;
  titleColor: string;
  visibility: ArticleVisibility;
  status?: ArticleStatus;
  roleCodes: string[];
}

export const ARTICLE_STATUS_LABEL: Record<ArticleStatus, string> = {
  draft: "草稿",
  published: "已发布",
  unpublished: "已下架",
  blocked: "已屏蔽",
  deleted: "已删除",
};

export const ARTICLE_VISIBILITY_LABEL: Record<ArticleVisibility, string> = {
  public: "公开",
  authenticated: "登录可见",
  role_restricted: "指定角色",
  private: "仅自己",
};

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

function listQuery(query: { page?: number; pageSize?: number; search?: string; category?: string; status?: ArticleStatus; sort?: string } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function listPublicArticles(query?: Parameters<typeof listQuery>[0]): Promise<ArticleList> {
  return requestJson<ArticleList>(`/articles${listQuery(query)}`, { cache: "no-store" });
}

export function listVisibleArticles(accessToken: string, query?: Parameters<typeof listQuery>[0]): Promise<ArticleList> {
  return requestJson<ArticleList>(`/articles/visible${listQuery(query)}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function listMyArticles(accessToken: string, query?: Parameters<typeof listQuery>[0]): Promise<ArticleList> {
  return requestJson<ArticleList>(`/articles/mine${listQuery(query)}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function listAdminArticles(accessToken: string, query?: Parameters<typeof listQuery>[0]): Promise<ArticleList> {
  return requestJson<ArticleList>(`/articles/admin${listQuery(query)}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function getPublicArticle(slug: string): Promise<Article> {
  return requestJson<Article>(`/articles/${encodeURIComponent(slug)}`, { cache: "no-store" });
}

export function getVisibleArticle(accessToken: string, slug: string): Promise<Article> {
  return requestJson<Article>(`/articles/visible/${encodeURIComponent(slug)}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function listArticleComments(slug: string, accessToken?: string): Promise<{ items: ArticleComment[] }> {
  const path = accessToken
    ? `/articles/visible/${encodeURIComponent(slug)}/comments`
    : `/articles/${encodeURIComponent(slug)}/comments`;
  return requestJson<{ items: ArticleComment[] }>(path, {
    cache: "no-store",
    headers: accessToken ? authHeaders(accessToken) : undefined,
  });
}

export function createArticle(accessToken: string, input: ArticleInput): Promise<Article> {
  return requestJson<Article>("/articles", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(input),
  });
}

export function updateArticle(accessToken: string, id: number, input: ArticleInput): Promise<Article> {
  return requestJson<Article>(`/articles/${id}`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify(input),
  });
}

export function publishArticle(accessToken: string, id: number): Promise<Article> {
  return requestJson<Article>(`/articles/${id}/publish`, { method: "POST", headers: authHeaders(accessToken) });
}

export function unpublishArticle(accessToken: string, id: number): Promise<Article> {
  return requestJson<Article>(`/articles/${id}/unpublish`, { method: "POST", headers: authHeaders(accessToken) });
}

export function deleteArticle(accessToken: string, id: number): Promise<void> {
  return requestJson<void>(`/articles/${id}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export async function uploadArticleImages(accessToken: string, id: number, files: File[]): Promise<string[]> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  const result = await requestJson<{ images: string[] }>(`/articles/${id}/images`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body,
  });
  return result.images;
}

export function likeArticle(accessToken: string, id: number, liked: boolean): Promise<{ liked?: boolean; favorited?: boolean; likeCount: number; favoriteCount: number }> {
  return requestJson(`/articles/${id}/like`, {
    method: liked ? "POST" : "DELETE",
    headers: authHeaders(accessToken),
  });
}

export function favoriteArticle(accessToken: string, id: number, favorited: boolean): Promise<{ liked?: boolean; favorited?: boolean; likeCount: number; favoriteCount: number }> {
  return requestJson(`/articles/${id}/favorite`, {
    method: favorited ? "POST" : "DELETE",
    headers: authHeaders(accessToken),
  });
}

export function createArticleComment(accessToken: string, id: number, body: string, parentId?: number): Promise<ArticleComment> {
  return requestJson<ArticleComment>(`/articles/${id}/comments`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ body, parentId }),
  });
}

export function deleteArticleComment(accessToken: string, id: number): Promise<void> {
  return requestJson<void>(`/articles/comments/${id}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function moderateArticle(accessToken: string, id: number, input: Partial<ArticleInput> & { status?: ArticleStatus; isPinned?: boolean; pinOrder?: number; blockedReason?: string }): Promise<Article> {
  return requestJson<Article>(`/articles/admin/${id}`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify(input),
  });
}

export function listAdminComments(accessToken: string, articleId?: number): Promise<{ items: ArticleComment[] }> {
  const query = articleId ? `?articleId=${articleId}` : "";
  return requestJson<{ items: ArticleComment[] }>(`/articles/admin/comments${query}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function moderateArticleComment(accessToken: string, id: number, status: ArticleCommentStatus): Promise<void> {
  return requestJson<void>(`/articles/admin/comments/${id}`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ status }),
  });
}
