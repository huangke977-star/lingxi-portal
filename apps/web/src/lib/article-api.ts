import { requestJson } from "./auth-api";

export type ArticleStatus = "draft" | "published" | "unpublished" | "blocked" | "deleted";
export type ArticleVisibility = "public" | "authenticated" | "role_restricted" | "private";
export type ArticleCommentStatus = "active" | "blocked" | "deleted";

export interface ArticleAuthor {
  id: number;
  nickname: string;
  username: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  role: ArticleRole;
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
  recentCommenters: ArticleAuthor[];
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
  likeCount: number;
  liked: boolean;
  reported: boolean;
  pendingReportCount?: number;
  reports?: ArticleCommentReport[];
  author: ArticleAuthor;
  createdAt: string;
  updatedAt: string;
}

export type ArticleCommentReportReason = "spam" | "harassment" | "illegal" | "privacy" | "misinformation" | "other";
export type ArticleCommentReportStatus = "pending" | "resolved" | "rejected";

export interface ArticleCommentReport {
  id: number;
  commentId: number;
  article: { id: number; title: string; slug: string };
  reporter: ArticleAuthor;
  reason: ArticleCommentReportReason;
  detail: string | null;
  status: ArticleCommentReportStatus;
  resolution: string | null;
  createdAt: string;
  handledAt: string | null;
}

export interface ArticleList {
  items: Article[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ArticleMineSummary {
  total: number;
  draft: number;
  published: number;
  unpublished: number;
  blocked: number;
  deleted: number;
}

export interface ArticleCenterSummary {
  discover: number;
  mine: number;
  favorites: number;
  liked: number;
  manage: number;
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
  blocked: "受限",
  deleted: "回收站",
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

export function getPublicArticleCenterSummary(): Promise<ArticleCenterSummary> {
  return requestJson<ArticleCenterSummary>("/articles/center/summary", { cache: "no-store" });
}

export function getVisibleArticleCenterSummary(accessToken: string): Promise<ArticleCenterSummary> {
  return requestJson<ArticleCenterSummary>("/articles/visible/center/summary", {
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

export function getMyArticleSummary(accessToken: string): Promise<ArticleMineSummary> {
  return requestJson<ArticleMineSummary>("/articles/mine/summary", {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function getMyArticle(accessToken: string, id: number): Promise<Article> {
  return requestJson<Article>(`/articles/mine/${id}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function listFavoriteArticles(accessToken: string, query?: Parameters<typeof listQuery>[0]): Promise<ArticleList> {
  return requestJson<ArticleList>(`/articles/favorites${listQuery(query)}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function listLikedArticles(accessToken: string, query?: Parameters<typeof listQuery>[0]): Promise<ArticleList> {
  return requestJson<ArticleList>(`/articles/liked${listQuery(query)}`, {
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

export function restoreArticle(accessToken: string, id: number): Promise<Article> {
  return requestJson<Article>(`/articles/${id}/restore`, {
    method: "POST",
    headers: authHeaders(accessToken),
  });
}

export function permanentlyDeleteArticle(accessToken: string, id: number): Promise<void> {
  return requestJson<void>(`/articles/${id}/permanent`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
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

export function likeArticleComment(accessToken: string, id: number, liked: boolean): Promise<{ liked: boolean; likeCount: number }> {
  return requestJson(`/articles/comments/${id}/like`, {
    method: liked ? "POST" : "DELETE",
    headers: authHeaders(accessToken),
  });
}

export function reportArticleComment(
  accessToken: string,
  id: number,
  input: { reason: ArticleCommentReportReason; detail?: string },
): Promise<{ reported: true }> {
  return requestJson(`/articles/comments/${id}/report`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(input),
  });
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

export function getAdminArticle(accessToken: string, id: number): Promise<Article> {
  return requestJson<Article>(`/articles/admin/${id}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function getCommentReportSummary(accessToken: string): Promise<{ pending: number }> {
  return requestJson("/articles/admin/comment-reports/summary", {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function listCommentReports(
  accessToken: string,
  status?: ArticleCommentReportStatus,
): Promise<{ items: ArticleCommentReport[] }> {
  const query = status ? `?status=${status}` : "";
  return requestJson(`/articles/admin/comment-reports${query}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function moderateCommentReport(
  accessToken: string,
  id: number,
  input: { status: "resolved" | "rejected"; commentStatus?: ArticleCommentStatus; resolution?: string },
): Promise<void> {
  return requestJson<void>(`/articles/admin/comment-reports/${id}`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify(input),
  });
}

export function moderateArticleComment(accessToken: string, id: number, status: ArticleCommentStatus): Promise<void> {
  return requestJson<void>(`/articles/admin/comments/${id}`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ status }),
  });
}
