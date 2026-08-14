import { requestJson } from "./auth-api";

export type AnonymousTopicStatus = "active" | "closed";

export interface AnonymousTopicSummary {
  id: number;
  title: string;
  status: AnonymousTopicStatus;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnonymousTopicMessage {
  id: number;
  sequence: number;
  body: string;
  nickname: string | null;
  likeCount: number;
  dislikeCount: number;
  createdAt: string;
}

export interface AnonymousTopicDetail extends AnonymousTopicSummary {
  messages: AnonymousTopicMessage[];
  hasMore: boolean;
}

export interface AnonymousTopicPage {
  items: AnonymousTopicSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AnonymousIdentity {
  identityToken: string;
  nickname: string;
  isCreator: boolean;
}

const VISITOR_KEY_STORAGE = "hlovet.anonymous-topic.visitor-key";
const IDENTITY_STORAGE_PREFIX = "hlovet.anonymous-topic.identity:";

export function getAnonymousVisitorKey(): string {
  if (typeof window === "undefined") return "server-anonymous-visitor-key";
  const saved = window.localStorage.getItem(VISITOR_KEY_STORAGE);
  if (saved && saved.length >= 16) return saved;
  const key = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}-${Math.random()}`;
  window.localStorage.setItem(VISITOR_KEY_STORAGE, key);
  return key;
}

export function readAnonymousIdentity(topicId: number): AnonymousIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${IDENTITY_STORAGE_PREFIX}${topicId}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as AnonymousIdentity;
    return value.identityToken && value.nickname ? value : null;
  } catch { return null; }
}

export function saveAnonymousIdentity(topicId: number, identity: AnonymousIdentity): void {
  if (typeof window !== "undefined") window.localStorage.setItem(`${IDENTITY_STORAGE_PREFIX}${topicId}`, JSON.stringify(identity));
}

export function listAnonymousTopics(page = 1, pageSize = 8, q = ""): Promise<AnonymousTopicPage> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q.trim()) params.set("q", q.trim());
  return requestJson(`/anonymous-topics?${params.toString()}`, { cache: "no-store" });
}

export function getAnonymousTopic(id: number, input: { limit?: number; beforeSequence?: number } = {}): Promise<AnonymousTopicDetail> {
  const params = new URLSearchParams();
  if (input.limit) params.set("limit", String(input.limit));
  if (input.beforeSequence) params.set("beforeSequence", String(input.beforeSequence));
  const query = params.toString();
  return requestJson(`/anonymous-topics/${id}${query ? `?${query}` : ""}`, { cache: "no-store" });
}

export function createAnonymousTopic(input: { title: string; nickname: string; password: string }): Promise<AnonymousTopicSummary & AnonymousIdentity> {
  return requestJson("/anonymous-topics", { method: "POST", body: JSON.stringify({ ...input, visitorKey: getAnonymousVisitorKey() }) });
}

export function claimAnonymousIdentity(topicId: number, input: { password: string; nickname?: string; create?: boolean }): Promise<AnonymousIdentity> {
  return requestJson(`/anonymous-topics/${topicId}/identity`, { method: "POST", body: JSON.stringify({ ...input, visitorKey: getAnonymousVisitorKey() }) });
}

export function sendAnonymousMessage(topicId: number, body: string, identityToken?: string): Promise<AnonymousTopicMessage> {
  return requestJson(`/anonymous-topics/${topicId}/messages`, { method: "POST", body: JSON.stringify({ body, identityToken, visitorKey: getAnonymousVisitorKey() }) });
}

export function reactToAnonymousMessage(messageId: number, value: "up" | "down"): Promise<AnonymousTopicMessage> {
  return requestJson(`/anonymous-topics/messages/${messageId}/reaction`, { method: "POST", body: JSON.stringify({ value, visitorKey: getAnonymousVisitorKey() }) });
}

export function updateAnonymousTopic(accessToken: string, id: number, input: Partial<{ status: AnonymousTopicStatus; isHidden: boolean }>): Promise<AnonymousTopicSummary> {
  return requestJson(`/anonymous-topics/admin/${id}`, { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
}

export function updateAnonymousMessage(accessToken: string, id: number, isHidden: boolean): Promise<AnonymousTopicMessage> {
  return requestJson(`/anonymous-topics/admin/messages/${id}`, { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ isHidden }) });
}
