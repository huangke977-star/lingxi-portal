import { requestBlob, requestJson } from "./auth-api";

export interface DatabaseBackup {
  name: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface SystemStatus {
  generatedAt: string;
  application: {
    status: "ok";
    service: string;
    nodeVersion: string;
    environment: string;
    uptimeSeconds: number;
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      externalBytes: number;
    };
  };
  database: {
    connected: boolean;
    latencyMs: number | null;
    version: string | null;
    sizeBytes: number | null;
    migrationCount: number | null;
    latestMigration: { name: string; finishedAt: string | null } | null;
    error: string | null;
  };
  redis: {
    connected: boolean;
    latencyMs: number | null;
    version: string | null;
    keyCount: number | null;
    usedMemoryBytes: number | null;
    maxMemoryBytes: number | null;
    connectedClients: number | null;
    error: string | null;
  };
  storage: {
    totalBytes: number;
    totalFiles: number;
    items: Array<{
      key: string;
      label: string;
      available: boolean;
      sizeBytes: number;
      fileCount: number;
    }>;
  };
  backups: {
    available: boolean;
    totalBytes: number;
    fileCount: number;
    latest: DatabaseBackup | null;
    items: DatabaseBackup[];
  };
  containerRuntime: {
    connected: false;
    message: string;
  };
}

export function getSystemStatus(accessToken: string): Promise<SystemStatus> {
  return requestJson<SystemStatus>("/admin/system/status", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function createDatabaseBackup(accessToken: string): Promise<DatabaseBackup> {
  return requestJson("/admin/system/backups", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
}

export function downloadDatabaseBackup(accessToken: string, name: string): Promise<Blob> {
  return requestBlob(`/admin/system/backups/${encodeURIComponent(name)}/download`, { headers: { Authorization: `Bearer ${accessToken}` } });
}

export function deleteDatabaseBackup(accessToken: string, name: string): Promise<{ success: true }> {
  return requestJson(`/admin/system/backups/${encodeURIComponent(name)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
}

export function restoreDatabaseBackup(accessToken: string, name: string): Promise<{ success: true; restored: string; safetyBackup: DatabaseBackup }> {
  return requestJson(`/admin/system/backups/${encodeURIComponent(name)}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ confirmation: name }),
  });
}
