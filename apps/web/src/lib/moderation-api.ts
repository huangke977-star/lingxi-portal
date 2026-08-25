import { requestJson } from "./auth-api";

export type ModerationReportSource = "article" | "comment" | "group_message";
export type ModerationReportStatus = "pending" | "resolved" | "rejected";

export interface ModerationUser {
  id: number;
  nickname: string;
  username: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  isAdministrator: boolean;
  role: { code: string; name: string; level: number };
}

export interface ModerationReport {
  key: string;
  id: number;
  source: ModerationReportSource;
  sourceLabel: string;
  status: ModerationReportStatus;
  reason: string;
  detail: string | null;
  resolution: string | null;
  reporter: ModerationUser;
  targetUser: ModerationUser | null;
  article: { id: number; title: string; slug: string; author: ModerationUser } | null;
  comment: { id: number; body: string; status: string } | null;
  group: { id: number; conversationId: number; name: string; avatarUrl: string | null } | null;
  message: {
    id: number;
    body: string;
    type: string;
    sender: ModerationUser;
    attachments: Array<{
      id: number;
      conversationId: number;
      kind: "image" | "file" | "audio" | "video";
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      downloadUrl: string;
      thumbnailUrl: string | null;
      createdAt: string;
    }>;
    createdAt: string;
  } | null;
  createdAt: string;
  handledAt: string | null;
}

export interface ModerationReportPage {
  items: ModerationReport[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ModerationReportSummary {
  total: number;
  pending: number;
  bySource: Record<ModerationReportSource, number>;
}

export type ModerationRuleType = "sensitive_word" | "link_rate" | "duplicate_content" | "high_frequency";
export type ModerationRuleAction = "record" | "block";

export interface ModerationRule {
  id: number;
  name: string;
  type: ModerationRuleType;
  action: ModerationRuleAction;
  sources: ModerationReportSource[];
  keywords: string;
  threshold: number;
  windowSeconds: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModerationRuleHit {
  id: number;
  rule: Pick<ModerationRule, "id" | "name" | "type">;
  actor: Pick<ModerationUser, "id" | "nickname" | "username" | "avatarUrl">;
  source: ModerationReportSource;
  action: ModerationRuleAction;
  contentPreview: string;
  detail: string;
  createdAt: string;
}

export interface ModerationTemplate {
  id: number;
  name: string;
  status: Exclude<ModerationReportStatus, "pending">;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModerationSettings {
  deadlineHours: number;
  reminderLeadHours: number;
  automaticRemindersEnabled: boolean;
  updatedAt: string;
}

export interface ModerationOverview {
  reports: {
    total: number;
    pending: number;
    resolved: number;
    rejected: number;
    overdue: number;
    averageHandleMinutes: number | null;
    bySource: Record<ModerationReportSource, { total: number; pending: number; overdue: number }>;
  };
  ruleHits: { last7Days: number; last30Days: number; byType: Array<{ type: ModerationRuleType; count: number }> };
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export function listModerationReports(
  accessToken: string,
  query: { status: ModerationReportStatus | "all"; type: ModerationReportSource | "all"; page: number; pageSize: number },
): Promise<ModerationReportPage> {
  const params = new URLSearchParams({
    status: query.status,
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.type !== "all") params.set("type", query.type);
  return requestJson(`/moderation/reports?${params.toString()}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function listMyReports(accessToken: string): Promise<{ items: ModerationReport[] }> {
  return requestJson("/moderation/my-reports", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function getModerationReportSummary(accessToken: string): Promise<ModerationReportSummary> {
  return requestJson("/moderation/reports/summary", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function getModerationOverview(accessToken: string): Promise<ModerationOverview> {
  return requestJson("/moderation/overview", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function listModerationRules(accessToken: string): Promise<{ items: ModerationRule[] }> {
  return requestJson("/moderation/rules", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function createModerationRule(accessToken: string, body: Omit<ModerationRule, "id" | "createdAt" | "updatedAt">): Promise<ModerationRule> {
  return requestJson("/moderation/rules", { method: "POST", headers: { ...authHeaders(accessToken), "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function updateModerationRule(accessToken: string, id: number, body: Partial<Omit<ModerationRule, "id" | "type" | "createdAt" | "updatedAt">>): Promise<ModerationRule> {
  return requestJson(`/moderation/rules/${id}`, { method: "PATCH", headers: { ...authHeaders(accessToken), "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function deleteModerationRule(accessToken: string, id: number): Promise<{ success: true }> {
  return requestJson(`/moderation/rules/${id}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function listModerationRuleHits(accessToken: string, page = 1, pageSize = 20): Promise<{ items: ModerationRuleHit[]; total: number; page: number; pageSize: number; totalPages: number }> {
  return requestJson(`/moderation/rule-hits?page=${page}&pageSize=${pageSize}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function listModerationTemplates(accessToken: string): Promise<{ items: ModerationTemplate[] }> {
  return requestJson("/moderation/templates", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function createModerationTemplate(accessToken: string, body: Pick<ModerationTemplate, "name" | "status" | "content" | "enabled">): Promise<ModerationTemplate> {
  return requestJson("/moderation/templates", { method: "POST", headers: { ...authHeaders(accessToken), "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function updateModerationTemplate(accessToken: string, id: number, body: Partial<Pick<ModerationTemplate, "name" | "status" | "content" | "enabled">>): Promise<ModerationTemplate> {
  return requestJson(`/moderation/templates/${id}`, { method: "PATCH", headers: { ...authHeaders(accessToken), "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function deleteModerationTemplate(accessToken: string, id: number): Promise<{ success: true }> {
  return requestJson(`/moderation/templates/${id}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function getModerationSettings(accessToken: string): Promise<ModerationSettings> {
  return requestJson("/moderation/settings", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function updateModerationSettings(accessToken: string, body: Omit<ModerationSettings, "updatedAt">): Promise<ModerationSettings> {
  return requestJson("/moderation/settings", { method: "PUT", headers: { ...authHeaders(accessToken), "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function bulkHandleModerationReports(accessToken: string, body: { source: ModerationReportSource; reportIds: number[]; status: Exclude<ModerationReportStatus, "pending">; resolution: string }): Promise<{ succeeded: number[]; failed: Array<{ id: number; message: string }> }> {
  return requestJson("/moderation/reports/bulk", { method: "POST", headers: { ...authHeaders(accessToken), "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
