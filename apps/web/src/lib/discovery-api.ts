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
  coverPath: string | null;
  visibility: Exclude<ArticleVisibility, "role_restricted">;
  sortOrder: number;
  owner: ArticleAuthor;
  articles: DiscoveryArticle[];
  articleCount: number;
  subscriberCount: number;
  subscribed: boolean;
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
  subscriberCount: number;
  subscribed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSettings {
  profileAccess: "public" | "authenticated" | "friends" | "private";
  searchable: boolean;
  friendRequestPolicy: "everyone" | "none";
  directMessagePolicy: "everyone" | "request" | "friends" | "none";
  groupInvitationPolicy: "everyone" | "friends" | "none";
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

export interface DiscoveryRecommendations {
  topics: Array<{ id: number; title: string; slug: string; description: string; coverPath: string | null; articleCount: number; subscriberCount: number; subscribed: boolean; updatedAt: string }>;
  collections: Array<{ id: number; name: string; description: string; articleCount: number; subscriberCount: number; subscribed: boolean; owner: ArticleAuthor; updatedAt: string }>;
  groups: Array<{ id: number; conversationId: number; name: string; avatarUrl: string | null; announcement: string; memberCount: number; joinMode: "approval" | "invite_only"; isMember: boolean; updatedAt: string }>;
  authors: Array<ArticleAuthor & { topCategory: string; articleCount: number; engagementCount: number; subscribed: boolean }>;
  batch: number;
  hasMore: boolean;
}

export type RecommendationTargetType = "article" | "topic" | "collection" | "author" | "group";

export interface ResourceCatalogItem {
  article: DiscoveryArticle;
  minimumPointCost: number;
  blockCount: number;
  exchangeCount: number;
}

export interface ResourceCatalog {
  items: ResourceCatalogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface OnboardingState {
  completed: boolean;
  topics: Array<Pick<ArticleTopic, "id" | "title" | "slug" | "description" | "coverPath" | "articleCount" | "subscriberCount" | "subscribed">>;
  authors: Array<{ id: number; nickname: string; username: string; avatarUrl: string | null; topCategory: string; subscribed: boolean }>;
}

export interface ContentSubscriptions {
  topics: Array<{ id: number; title: string; slug: string; description: string; coverPath: string | null; articleCount: number; subscriberCount: number; frequency: "instant" | "daily" | "muted"; subscribedAt: string }>;
  collections: Array<{ id: number; name: string; description: string; owner: ArticleAuthor; articleCount: number; subscriberCount: number; subscribedAt: string }>;
  tags: Array<{ tag: string; frequency: "instant" | "daily" | "muted"; subscribedAt: string }>;
}

export interface SubscriptionSettings {
  items: Array<{ author: ArticleAuthor; notifyNewArticles: boolean; frequency: "instant" | "daily" | "muted"; subscribedAt: string }>;
  digestEnabled: boolean;
}

const authHeaders = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

function pageQuery(input: { page?: number; pageSize?: number; q?: string; sort?: string; batch?: number } = {}) {
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
  return requestJson<SubscriptionSettings>("/discovery/subscriptions/settings", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function listContentSubscriptions(accessToken: string) {
  return requestJson<ContentSubscriptions>("/discovery/subscriptions/content", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function updateSubscriptionSetting(accessToken: string, authorId: number, input: { notifyNewArticles?: boolean; frequency?: "instant" | "daily" | "muted" }) {
  return requestJson<{ authorId: number; notifyNewArticles: boolean; frequency?: "instant" | "daily" | "muted" }>(`/discovery/subscriptions/${authorId}/settings`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function listMyCollections(accessToken: string) {
  return requestJson<{ items: ArticleCollection[] }>("/discovery/collections/mine", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function listDiscoveryRecommendations(accessToken: string, batch = 0) {
  return requestJson<DiscoveryRecommendations>(`/discovery/recommendations${pageQuery({ batch })}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function markRecommendationNotInterested(accessToken: string, targetType: RecommendationTargetType, targetId: number) {
  return requestJson<{ hidden: true; targetType: RecommendationTargetType; targetId: number }>("/discovery/recommendations/feedback", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ targetType, targetId }),
  });
}

export function removeRecommendationFeedback(accessToken: string, targetType: RecommendationTargetType, targetId: number) {
  return requestJson<{ hidden: false; targetType: RecommendationTargetType; targetId: number }>(`/discovery/recommendations/feedback/${targetType}/${targetId}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
}

export function getOnboarding(accessToken: string) {
  return requestJson<OnboardingState>("/discovery/onboarding", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function completeOnboarding(accessToken: string, topicIds: number[], authorIds: number[]) {
  return requestJson<{ completed: true; topicIds: number[]; authorIds: number[] }>("/discovery/onboarding", { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify({ topicIds, authorIds }) });
}

export function listResourceCatalog(accessToken?: string | null, input: { q?: string; page?: number; pageSize?: number; sort?: "latest" | "popular" | "price" } = {}) {
  const path = accessToken ? "/discovery/resources/visible" : "/discovery/resources";
  return requestJson<ResourceCatalog>(`${path}${pageQuery(input)}`, { cache: "no-store", headers: accessToken ? authHeaders(accessToken) : undefined });
}

export function getResourceCatalogSummary(accessToken: string) {
  return requestJson<{ purchasedBlocks: number; soldBlocks: number; pendingPoints: number }>("/discovery/resources/summary", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function subscribeTopic(accessToken: string, id: number) {
  return requestJson<{ subscribed: true; subscriberCount: number }>(`/discovery/topics/${id}/subscribe`, { method: "POST", headers: authHeaders(accessToken) });
}

export function unsubscribeTopic(accessToken: string, id: number) {
  return requestJson<{ subscribed: false; subscriberCount: number }>(`/discovery/topics/${id}/subscribe`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function updateTopicSubscriptionFrequency(accessToken: string, id: number, frequency: "instant" | "daily" | "muted") {
  return requestJson<{ topicId: number; frequency: typeof frequency }>(`/discovery/topics/${id}/subscription`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify({ frequency }) });
}

export function subscribeTag(accessToken: string, tag: string) {
  return requestJson<{ subscribed: true; tag: string; frequency: "instant" }>("/discovery/tags/subscribe", { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify({ tag }) });
}

export function unsubscribeTag(accessToken: string, tag: string) {
  return requestJson<{ subscribed: false; tag: string }>(`/discovery/tags/subscribe/${encodeURIComponent(tag)}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function updateTagSubscriptionFrequency(accessToken: string, tag: string, frequency: "instant" | "daily" | "muted") {
  return requestJson<{ tag: string; frequency: typeof frequency }>(`/discovery/tags/subscriptions/${encodeURIComponent(tag)}`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify({ frequency }) });
}

export function subscribeCollection(accessToken: string, id: number) {
  return requestJson<{ subscribed: true; subscriberCount: number }>(`/discovery/collections/${id}/subscribe`, { method: "POST", headers: authHeaders(accessToken) });
}

export function unsubscribeCollection(accessToken: string, id: number) {
  return requestJson<{ subscribed: false; subscriberCount: number }>(`/discovery/collections/${id}/subscribe`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function listVisibleCollections(accessToken: string, input: { q?: string; page?: number; pageSize?: number } = {}) {
  return requestJson<{ items: ArticleCollection[]; total: number; page: number; pageSize: number; totalPages: number }>(`/discovery/collections/visible${pageQuery(input)}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function createCollection(accessToken: string, input: { name: string; description?: string; coverPath?: string; visibility?: ArticleCollection["visibility"]; articleIds?: number[] }) {
  return requestJson<ArticleCollection>("/discovery/collections", { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function updateCollection(accessToken: string, id: number, input: Partial<Pick<ArticleCollection, "name" | "description" | "coverPath" | "visibility" | "sortOrder">>) {
  return requestJson<ArticleCollection>(`/discovery/collections/${id}`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function uploadCollectionCover(accessToken: string, id: number, file: File) {
  const body = new FormData();
  body.set("file", file);
  return requestJson<ArticleCollection>(`/discovery/collections/${id}/cover`, { method: "POST", headers: authHeaders(accessToken), body });
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

export function listTopics(accessToken?: string | null, input: { page?: number; pageSize?: number; q?: string } = {}) {
  const path = accessToken ? "/discovery/topics/visible" : "/discovery/topics";
  return requestJson<{ items: ArticleTopic[]; total: number; page: number; pageSize: number; totalPages: number }>(`${path}${pageQuery(input)}`, { cache: "no-store", headers: accessToken ? authHeaders(accessToken) : undefined });
}

export function getTopic(slug: string, accessToken?: string | null) {
  return requestJson<ArticleTopic>(`/discovery/topics/${accessToken ? "visible" : "public"}/${encodeURIComponent(slug)}`, { cache: "no-store", headers: accessToken ? authHeaders(accessToken) : undefined });
}

export function listAdminTopics(accessToken: string) {
  return requestJson<{ items: ArticleTopic[] }>("/discovery/admin/topics", { cache: "no-store", headers: authHeaders(accessToken) });
}

export type ArticleTopicInput = Omit<ArticleTopic, "id" | "articles" | "articleCount" | "subscriberCount" | "subscribed" | "createdAt" | "updatedAt">;

export function createTopic(accessToken: string, input: ArticleTopicInput & { articleIds?: number[] }) {
  return requestJson<ArticleTopic>("/discovery/admin/topics", { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function updateTopic(accessToken: string, id: number, input: Partial<ArticleTopicInput>) {
  return requestJson<ArticleTopic>(`/discovery/admin/topics/${id}`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function deleteTopic(accessToken: string, id: number) {
  return requestJson<{ success: true }>(`/discovery/admin/topics/${id}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function uploadTopicCover(accessToken: string, id: number, file: File) {
  const body = new FormData();
  body.set("file", file);
  return requestJson<ArticleTopic>(`/discovery/admin/topics/${id}/cover`, { method: "POST", headers: authHeaders(accessToken), body });
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
