import { requestJson } from "./auth-api";

export type FeedbackCategory = "bug" | "account" | "content" | "payment" | "other";
export type FeedbackStatus = "pending" | "in_progress" | "resolved" | "closed";

export interface FeedbackUser { id: number; username: string; nickname: string; avatarUrl: string | null }
export interface FeedbackSummary { id: number; category: FeedbackCategory; title: string; status: FeedbackStatus; user: FeedbackUser; replyCount: number; createdAt: string; updatedAt: string }
export interface FeedbackDetail extends FeedbackSummary {
  content: string;
  reviewedAt: string | null;
  reviewedBy: FeedbackUser | null;
  replies: Array<{ id: number; content: string; author: FeedbackUser; createdAt: string }>;
}
export interface FeedbackPage { items: FeedbackSummary[]; total: number; page: number; pageSize: number; totalPages: number }

function headers(accessToken: string): HeadersInit { return { Authorization: `Bearer ${accessToken}` }; }
function query(page: number, pageSize: number, q: string, status?: FeedbackStatus) { const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) }); if (q.trim()) params.set("q", q.trim()); if (status) params.set("status", status); return `?${params}`; }

export function listMyFeedback(accessToken: string, page = 1, pageSize = 12, q = ""): Promise<FeedbackPage> { return requestJson(`/feedback/mine${query(page, pageSize, q)}`, { cache: "no-store", headers: headers(accessToken) }); }
export function listFeedbackInbox(accessToken: string, page = 1, pageSize = 12, q = "", status?: FeedbackStatus): Promise<FeedbackPage> { return requestJson(`/feedback/inbox${query(page, pageSize, q, status)}`, { cache: "no-store", headers: headers(accessToken) }); }
export function getFeedback(accessToken: string, id: number): Promise<FeedbackDetail> { return requestJson(`/feedback/${id}`, { cache: "no-store", headers: headers(accessToken) }); }
export function createFeedback(accessToken: string, input: { category: FeedbackCategory; title: string; content: string }): Promise<FeedbackDetail> { return requestJson("/feedback", { method: "POST", headers: { ...headers(accessToken), "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
export function updateFeedbackStatus(accessToken: string, id: number, status: FeedbackStatus): Promise<FeedbackDetail> { return requestJson(`/feedback/${id}/status`, { method: "PATCH", headers: { ...headers(accessToken), "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); }
export function replyFeedback(accessToken: string, id: number, content: string): Promise<FeedbackDetail> { return requestJson(`/feedback/${id}/replies`, { method: "POST", headers: { ...headers(accessToken), "Content-Type": "application/json" }, body: JSON.stringify({ content }) }); }
