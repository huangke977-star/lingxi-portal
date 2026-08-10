import { requestJson } from "./auth-api";
import type { ArticleAuthor, ArticleVisibility } from "./article-api";

export interface DiscoveryLink {
  id: number;
  label: string;
  href: string;
}

export interface DiscoveryArticle {
  id: number;
  title: string;
  slug: string;
  category: string;
  tags: string[];
  titleColor: string;
  coverPath: string | null;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  commentCount: number;
  publishedAt: string | null;
  author: ArticleAuthor;
  collections: DiscoveryLink[];
  topics: DiscoveryLink[];
}

export interface SubscriptionFeed {
  items: Array<{ article: DiscoveryArticle; readAt: string | null }>;
  total: number;
  unread: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ArticleCollection {
  id: number;
  name: string;
  description: string;
  visibility: Exclude<ArticleVisibility, "role_restricted">;
  sortOrder: number;
  owner: ArticleAuthor;
  articles: DiscoveryArticle[];
  articleCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleTopic {
  id: number;
  title: string;
  slug: string;
  description: string;
  coverPath: string | null;
  visibility: "public" | "authenticated" | "role_restricted";
  status: "active" | "disabled";
  sortOrder: number;
  roleCodes: string[];
  articles: DiscoveryArticle[];
  articleCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSettings {
  showBio: boolean;
  showJoinedAt: boolean;
  showStats: boolean;
  showFollowingCount: boolean;
  showPinnedContent: boolean;
  pinnedArticleId: number | null;
  pinnedCollectionId: number | null;
}

export interface ProfileShowcase {
  settings: ProfileSettings;
  visitCount: number | null;
  pinnedArticle: DiscoveryArticle | null;
  pinnedCollection: ArticleCollection | null;
  collections: ArticleCollection[];
}

const authHeaders = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

function pageQuery(input: { page?: number; pageSize?: number; sort?: string } = {}) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value));
  });
  return params.size ? `?${params}` : "";
}

export function listSubscriptionFeed(accessToken: string, input: { page?: number; pageSize?: number; sort?: "latest" | "unread" | "popular" } = {}) {
  return requestJson<SubscriptionFeed>(`/discovery/feed${pageQuery(input)}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function markSubscriptionFeedRead(accessToken: string, articleId: number) {
  return requestJson<{ articleId: number; readAt: string }>(`/discovery/feed/${articleId}/read`, { method: "POST", headers: authHeaders(accessToken) });
}

export function markAllSubscriptionFeedRead(accessToken: string) {
  return requestJson<{ count: number; readAt: string }>("/discovery/feed/read-all", { method: "POST", headers: authHeaders(accessToken) });
}

export function listSubscriptionSettings(accessToken: string) {
  return requestJson<{ items: Array<{ author: ArticleAuthor; notifyNewArticles: boolean; subscribedAt: string }> }>("/discovery/subscriptions/settings", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function updateSubscriptionSetting(accessToken: string, authorId: number, notifyNewArticles: boolean) {
  return requestJson<{ authorId: number; notifyNewArticles: boolean }>(`/discovery/subscriptions/${authorId}/settings`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify({ notifyNewArticles }) });
}

export function listMyCollections(accessToken: string) {
  return requestJson<{ items: ArticleCollection[] }>("/discovery/collections/mine", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function createCollection(accessToken: string, input: { name: string; description?: string; visibility?: ArticleCollection["visibility"] }) {
  return requestJson<ArticleCollection>("/discovery/collections", { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function updateCollection(accessToken: string, id: number, input: Partial<Pick<ArticleCollection, "name" | "description" | "visibility" | "sortOrder">>) {
  return requestJson<ArticleCollection>(`/discovery/collections/${id}`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function deleteCollection(accessToken: string, id: number) {
  return requestJson<{ success: true }>(`/discovery/collections/${id}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function addCollectionArticle(accessToken: string, id: number, articleId: number) {
  return requestJson<ArticleCollection>(`/discovery/collections/${id}/articles/${articleId}`, { method: "POST", headers: authHeaders(accessToken) });
}

export function removeCollectionArticle(accessToken: string, id: number, articleId: number) {
  return requestJson<ArticleCollection>(`/discovery/collections/${id}/articles/${articleId}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function reorderCollectionArticles(accessToken: string, id: number, ids: number[]) {
  return requestJson<ArticleCollection>(`/discovery/collections/${id}/articles/order`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify({ ids }) });
}

export function getCollection(id: number, accessToken?: string | null) {
  return requestJson<ArticleCollection>(`/discovery/collections/${accessToken ? "visible" : "public"}/${id}`, { cache: "no-store", headers: accessToken ? authHeaders(accessToken) : undefined });
}

export function listTopics(accessToken?: string | null, input: { page?: number; pageSize?: number } = {}) {
  const path = accessToken ? "/discovery/topics/visible" : "/discovery/topics";
  return requestJson<{ items: ArticleTopic[]; total: number; page: number; pageSize: number; totalPages: number }>(`${path}${pageQuery(input)}`, { cache: "no-store", headers: accessToken ? authHeaders(accessToken) : undefined });
}

export function getTopic(slug: string, accessToken?: string | null) {
  return requestJson<ArticleTopic>(`/discovery/topics/${accessToken ? "visible" : "public"}/${encodeURIComponent(slug)}`, { cache: "no-store", headers: accessToken ? authHeaders(accessToken) : undefined });
}

export function listAdminTopics(accessToken: string) {
  return requestJson<{ items: ArticleTopic[] }>("/discovery/admin/topics", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function createTopic(accessToken: string, input: Omit<ArticleTopic, "id" | "articles" | "articleCount" | "createdAt" | "updatedAt">) {
  return requestJson<ArticleTopic>("/discovery/admin/topics", { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function updateTopic(accessToken: string, id: number, input: Partial<Omit<ArticleTopic, "id" | "articles" | "articleCount" | "createdAt" | "updatedAt">>) {
  return requestJson<ArticleTopic>(`/discovery/admin/topics/${id}`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function deleteTopic(accessToken: string, id: number) {
  return requestJson<{ success: true }>(`/discovery/admin/topics/${id}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function addTopicArticle(accessToken: string, id: number, articleId: number) {
  return requestJson<ArticleTopic>(`/discovery/admin/topics/${id}/articles/${articleId}`, { method: "POST", headers: authHeaders(accessToken) });
}

export function removeTopicArticle(accessToken: string, id: number, articleId: number) {
  return requestJson<ArticleTopic>(`/discovery/admin/topics/${id}/articles/${articleId}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function reorderTopicArticles(accessToken: string, id: number, ids: number[]) {
  return requestJson<ArticleTopic>(`/discovery/admin/topics/${id}/articles/order`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify({ ids }) });
}

export function getProfileSettings(accessToken: string) {
  return requestJson<ProfileSettings>("/discovery/profile/settings", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function updateProfileSettings(accessToken: string, input: Partial<ProfileSettings>) {
  return requestJson<ProfileSettings>("/discovery/profile/settings", { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function getProfileShowcase(username: string, accessToken?: string | null) {
  return requestJson<ProfileShowcase>(`/discovery/profiles/${accessToken ? "visible" : "public"}/${encodeURIComponent(username)}`, { cache: "no-store", headers: accessToken ? authHeaders(accessToken) : undefined });
}
