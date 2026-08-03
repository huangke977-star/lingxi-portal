import { requestJson } from "./auth-api";

export interface AuditLog {
  id: number;
  actor: { id: number | null; username: string; nickname: string };
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

export interface AuditLogPage {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function listAuditLogs(
  accessToken: string,
  query: { page?: number; pageSize?: number; search?: string; scope?: string; result?: string },
): Promise<AuditLogPage> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return requestJson(`/admin/audit?${params}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
