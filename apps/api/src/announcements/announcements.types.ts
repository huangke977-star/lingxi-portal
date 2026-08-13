export interface AnnouncementSummaryResponse {
  id: number;
  title: string;
  summary: string;
  audience: "public" | "authenticated" | "role_restricted";
  status: "draft" | "scheduled" | "published" | "expired" | "archived";
  publishMode: "immediate" | "scheduled";
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
export interface AnnouncementDetailResponse extends AnnouncementSummaryResponse {
  content: string;
  confirmedAt: string | null;
  delivery: {
    startedAt: string | null;
    deliveredAt: string | null;
    attempts: number;
    error: string | null;
  };
}
