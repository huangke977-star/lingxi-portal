import { requestBlob, requestJson } from "./auth-api";

export interface AccountPrivacyOverview {
  deletion: {
    pending: boolean;
    requestedAt: string | null;
    scheduledAt: string | null;
    deletedAt: string | null;
  };
  totp: { enabled: boolean; confirmedAt: string | null };
  blocked: BlockedUser[];
}

export interface BlockedUser {
  friendshipId: number;
  user: {
    id: number;
    username: string;
    nickname: string;
    avatarUrl: string | null;
  };
}

export interface ExportJob {
  id: number;
  status: "queued" | "processing" | "completed" | "failed" | "expired" | string;
  error?: string | null;
  expiresAt: string;
  completedAt?: string | null;
}

export interface DeletedUserPage {
  items: Array<{
    id: number;
    originalUsername: string | null;
    originalNickname: string | null;
    originalEmail: string | null;
    deletedAt: string | null;
    articleCount: number;
    commentCount: number;
  }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DeletedUserContent {
  user: {
    id: number;
    originalUsername: string | null;
    originalNickname: string | null;
    originalEmail: string | null;
    deletedAt: string | null;
  };
  articles: Array<{
    id: number;
    title: string;
    status: string;
    createdAt: string;
    publishedAt: string | null;
  }>;
  comments: Array<{
    id: number;
    articleId: number;
    article: { title: string };
    body: string;
    status: string;
    createdAt: string;
  }>;
}

const auth = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
});

export function getAccountPrivacyOverview(accessToken: string): Promise<AccountPrivacyOverview> {
  return requestJson("/account-privacy/me", {
    cache: "no-store",
    headers: auth(accessToken),
  });
}

export function requestDataExport(accessToken: string): Promise<ExportJob> {
  return requestJson("/account-privacy/me/exports", {
    method: "POST",
    headers: auth(accessToken),
  });
}

export function getDataExport(accessToken: string, id: number): Promise<ExportJob> {
  return requestJson(`/account-privacy/me/exports/${id}`, {
    cache: "no-store",
    headers: auth(accessToken),
  });
}

export function downloadDataExport(accessToken: string, id: number): Promise<Blob> {
  return requestBlob(`/account-privacy/me/exports/${id}/download`, {
    headers: auth(accessToken),
  });
}

export function requestAccountDeletion(accessToken: string, currentPassword: string) {
  return requestJson<{
    pending: true;
    scheduledAt: string;
    coolingOffDays: number;
  }>("/account-privacy/me/deletion", {
    method: "POST",
    headers: auth(accessToken),
    body: JSON.stringify({ currentPassword }),
  });
}

export function cancelAccountDeletion(accessToken: string) {
  return requestJson<{ pending: false }>("/account-privacy/me/deletion/cancel", { method: "PATCH", headers: auth(accessToken) });
}

export function beginTotpEnrollment(accessToken: string) {
  return requestJson<{ secret: string; otpAuthUri: string }>("/account-privacy/me/totp/enroll", { method: "POST", headers: auth(accessToken) });
}

export function confirmTotp(accessToken: string, code: string) {
  return requestJson<{ enabled: true; recoveryCodes: string[] }>("/account-privacy/me/totp/confirm", {
    method: "POST",
    headers: auth(accessToken),
    body: JSON.stringify({ code }),
  });
}

export function disableTotp(accessToken: string, code: string) {
  return requestJson<{ enabled: false }>("/account-privacy/me/totp/disable", {
    method: "PATCH",
    headers: auth(accessToken),
    body: JSON.stringify({ code }),
  });
}

export function disableTotpWithPassword(accessToken: string, currentPassword: string) {
  return requestJson<{ enabled: false }>("/account-privacy/me/totp/disable/password", {
    method: "PATCH",
    headers: auth(accessToken),
    body: JSON.stringify({ currentPassword }),
  });
}

export function requestTotpDisableEmailVerification(accessToken: string) {
  return requestJson<{ success: true; retryAfterSeconds: number }>("/account-privacy/me/totp/disable/email", { method: "POST", headers: auth(accessToken) });
}

export function disableTotpWithEmail(accessToken: string, code: string) {
  return requestJson<{ enabled: false }>("/account-privacy/me/totp/disable/email/confirm", {
    method: "POST",
    headers: auth(accessToken),
    body: JSON.stringify({ code }),
  });
}

export function listPrivacyAudit(accessToken: string) {
  return requestJson<Array<{ id: number; action: string; metadata: unknown; createdAt: string }>>("/account-privacy/me/audit?limit=50", {
    cache: "no-store",
    headers: auth(accessToken),
  });
}

export function listDeletedUsers(accessToken: string, query: { page: number; pageSize: number; search?: string }): Promise<DeletedUserPage> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.search?.trim()) params.set("search", query.search.trim());
  return requestJson(`/account-privacy/admin/deleted-users?${params}`, {
    cache: "no-store",
    headers: auth(accessToken),
  });
}

export function getDeletedUserContent(accessToken: string, id: number): Promise<DeletedUserContent> {
  return requestJson(`/account-privacy/admin/deleted-users/${id}/content`, {
    cache: "no-store",
    headers: auth(accessToken),
  });
}

export function resetUserTotp(accessToken: string, userId: number) {
  return requestJson<{ enabled: false; revokedSessions: number }>(`/account-privacy/admin/users/${userId}/totp/reset`, { method: "PATCH", headers: auth(accessToken) });
}
