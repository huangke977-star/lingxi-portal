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
    attachments: Array<{ kind: string; originalName: string }>;
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
