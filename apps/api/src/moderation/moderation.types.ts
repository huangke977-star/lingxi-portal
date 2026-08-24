import type { ModerationReportSource } from "./dto/moderation.dto";

export interface ModerationUserResponse {
  id: number;
  nickname: string;
  username: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  isAdministrator: boolean;
  role: { code: string; name: string; level: number };
}

export interface ModerationReportResponse {
  key: string;
  id: number;
  source: ModerationReportSource;
  sourceLabel: string;
  status: "pending" | "resolved" | "rejected";
  reason: string;
  detail: string | null;
  resolution: string | null;
  reporter: ModerationUserResponse;
  targetUser: ModerationUserResponse | null;
  article: {
    id: number;
    title: string;
    slug: string;
    author: ModerationUserResponse;
  } | null;
  comment: {
    id: number;
    body: string;
    status: string;
  } | null;
  group: {
    id: number;
    conversationId: number;
    name: string;
    avatarUrl: string | null;
  } | null;
  message: {
    id: number;
    body: string;
    type: string;
    sender: ModerationUserResponse;
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

export interface ModerationReportSummaryResponse {
  total: number;
  pending: number;
  bySource: Record<ModerationReportSource, number>;
}

export interface ModerationReportPageResponse {
  items: ModerationReportResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ModerationRuleResponse {
  id: number;
  name: string;
  type: "sensitive_word" | "link_rate" | "duplicate_content" | "high_frequency";
  action: "record" | "block";
  sources: ModerationReportSource[];
  keywords: string;
  threshold: number;
  windowSeconds: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModerationRuleHitResponse {
  id: number;
  rule: Pick<ModerationRuleResponse, "id" | "name" | "type">;
  actor: Pick<ModerationUserResponse, "id" | "nickname" | "username" | "avatarUrl">;
  source: ModerationReportSource;
  action: "record" | "block";
  contentPreview: string;
  detail: string;
  createdAt: string;
}

export interface ModerationTemplateResponse {
  id: number;
  name: string;
  status: "resolved" | "rejected";
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModerationSettingsResponse {
  deadlineHours: number;
  reminderLeadHours: number;
  automaticRemindersEnabled: boolean;
  updatedAt: string;
}

export interface ModerationOverviewResponse {
  reports: {
    total: number;
    pending: number;
    resolved: number;
    rejected: number;
    overdue: number;
    averageHandleMinutes: number | null;
    bySource: Record<ModerationReportSource, { total: number; pending: number; overdue: number }>;
  };
  ruleHits: {
    last7Days: number;
    last30Days: number;
    byType: Array<{ type: ModerationRuleResponse["type"]; count: number }>;
  };
}
