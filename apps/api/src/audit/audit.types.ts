export interface AuditLogResponse {
  id: number;
  actor: {
    id: number | null;
    username: string;
    nickname: string;
  };
  action: string;
  scope: "business" | "security" | "server";
  method: string;
  path: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  metadata: unknown;
  ip: string;
  userAgent: string;
  statusCode: number;
  durationMs: number;
  createdAt: string;
}

export interface AuditLogPageResponse {
  items: AuditLogResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
