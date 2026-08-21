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
    attachments: Array<{ kind: string; originalName: string }>;
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

export function getModerationReportSummary(accessToken: string): Promise<ModerationReportSummary> {
  return requestJson("/moderation/reports/summary", { cache: "no-store", headers: authHeaders(accessToken) });
}
