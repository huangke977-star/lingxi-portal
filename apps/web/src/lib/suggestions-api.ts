import { requestJson } from "./auth-api";

export const SUGGESTION_STATUSES = ["pending", "scheduled", "in_progress", "completed", "rejected"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export interface SuggestionUser {
  id: number;
  username: string;
  nickname: string;
}

export interface SuggestionSummary {
  id: number;
  title: string;
  status: SuggestionStatus;
  user: SuggestionUser;
  reviewedBy: SuggestionUser | null;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestionDetail extends SuggestionSummary {
  content: string;
  reviewedAt: string | null;
  replies: Array<{ id: number; content: string; author: SuggestionUser; createdAt: string }>;
}

export interface SuggestionPage {
  items: SuggestionSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function headers(accessToken: string) { return { Authorization: `Bearer ${accessToken}` }; }
function query(page: number, pageSize: number, q = "") {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q.trim()) params.set("q", q.trim());
  return `?${params.toString()}`;
}

export function listPublicSuggestions(page = 1, pageSize = 6, q = ""): Promise<SuggestionPage> {
  return requestJson(`/suggestions${query(page, pageSize, q)}`, { cache: "no-store" });
}

export function listMySuggestions(accessToken: string, page = 1, pageSize = 12, q = ""): Promise<SuggestionPage> {
  return requestJson(`/suggestions/mine${query(page, pageSize, q)}`, { cache: "no-store", headers: headers(accessToken) });
}

export function listSuggestionInbox(accessToken: string, page = 1, pageSize = 12, q = ""): Promise<SuggestionPage> {
  return requestJson(`/suggestions/inbox${query(page, pageSize, q)}`, { cache: "no-store", headers: headers(accessToken) });
}

export function getSuggestion(id: number): Promise<SuggestionDetail> {
  return requestJson(`/suggestions/${id}`, { cache: "no-store" });
}

export function createSuggestion(accessToken: string, input: { title: string; content: string }): Promise<SuggestionDetail> {
  return requestJson("/suggestions", { method: "POST", headers: headers(accessToken), body: JSON.stringify(input) });
}

export function updateSuggestionStatus(accessToken: string, id: number, status: SuggestionStatus): Promise<SuggestionDetail> {
  return requestJson(`/suggestions/${id}/status`, { method: "PATCH", headers: headers(accessToken), body: JSON.stringify({ status }) });
}

export function replyToSuggestion(accessToken: string, id: number, content: string): Promise<SuggestionDetail> {
  return requestJson(`/suggestions/${id}/replies`, { method: "POST", headers: headers(accessToken), body: JSON.stringify({ content }) });
}
