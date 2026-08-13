import { requestJson } from "./auth-api";

export type AnnouncementAudience = "public" | "authenticated" | "role_restricted";
export type AnnouncementStatus = "draft" | "scheduled" | "published" | "expired" | "archived";

export interface AnnouncementSummary {
  id: number;
  title: string;
  summary: string;
  audience: AnnouncementAudience;
  status: AnnouncementStatus;
  isPinned: boolean;
  pinOrder: number;
  pushEnabled: boolean;
  scheduledAt: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  recipientCount: number;
  viewCount: number;
  confirmedCount: number;
  unread: boolean;
  roleCodes: string[];
  createdBy: { id: number; username: string; nickname: string };
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementDetail extends AnnouncementSummary {
  content: string;
  confirmedAt: string | null;
  delivery: { startedAt: string | null; deliveredAt: string | null; attempts: number; error: string | null };
}

export interface AnnouncementPage {
  items: AnnouncementSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AnnouncementInput {
  title: string;
  summary: string;
  content: string;
  audience: AnnouncementAudience;
  status: "draft" | "scheduled" | "published" | "archived";
  isPinned: boolean;
  pinOrder: number;
  pushEnabled: boolean;
  scheduledAt: string | null;
  expiresAt: string | null;
  roleCodes: string[];
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

function queryString(query: { page?: number; pageSize?: number; search?: string; status?: AnnouncementStatus }) {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.status) params.set("status", query.status);
  return params.toString();
}

export function listAnnouncements(query: { page?: number; pageSize?: number; search?: string }, accessToken?: string | null): Promise<AnnouncementPage> {
  const path = accessToken ? "/announcements/visible" : "/announcements/public";
  return requestJson(`${path}?${queryString(query)}`, { cache: "no-store", ...(accessToken ? { headers: authHeaders(accessToken) } : {}) });
}

export function getAnnouncement(id: number, accessToken?: string | null): Promise<AnnouncementDetail> {
  const path = accessToken ? `/announcements/visible/${id}` : `/announcements/public/${id}`;
  return requestJson(path, { cache: "no-store", ...(accessToken ? { headers: authHeaders(accessToken) } : {}) });
}

export function confirmAnnouncement(accessToken: string, id: number): Promise<{ confirmedAt: string }> {
  return requestJson(`/announcements/visible/${id}/confirm`, { method: "POST", headers: authHeaders(accessToken) });
}

export function listAdminAnnouncements(accessToken: string, query: { page?: number; pageSize?: number; search?: string; status?: AnnouncementStatus }): Promise<AnnouncementPage> {
  return requestJson(`/announcements/admin?${queryString(query)}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function getAdminAnnouncement(accessToken: string, id: number): Promise<AnnouncementDetail> {
  return requestJson(`/announcements/admin/${id}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function createAnnouncement(accessToken: string, input: AnnouncementInput): Promise<AnnouncementDetail> {
  return requestJson("/announcements/admin", { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function updateAnnouncement(accessToken: string, id: number, input: AnnouncementInput): Promise<AnnouncementDetail> {
  return requestJson(`/announcements/admin/${id}`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function publishAnnouncement(accessToken: string, id: number): Promise<AnnouncementDetail> {
  return requestJson(`/announcements/admin/${id}/publish`, { method: "POST", headers: authHeaders(accessToken) });
}

export function archiveAnnouncement(accessToken: string, id: number): Promise<AnnouncementDetail> {
  return requestJson(`/announcements/admin/${id}/archive`, { method: "POST", headers: authHeaders(accessToken) });
}

export function deleteAnnouncement(accessToken: string, id: number): Promise<{ success: true }> {
  return requestJson(`/announcements/admin/${id}`, { method: "DELETE", headers: authHeaders(accessToken) });
}
