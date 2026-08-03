import { requestBlob, requestJson } from "./auth-api";

export interface DatabaseBackup {
  name: string;
  sizeBytes: number;
  updatedAt: string;
  remoteResults?: Array<{
    provider: "oss" | "r2";
    status: "success" | "failed";
    objectKey: string | null;
    error: string | null;
  }>;
  warning?: string | null;
}

export interface BackupConfiguration {
  automaticEnabled: boolean;
  scheduleTime: string;
  timezone: string;
  localRetentionDays: number;
  remoteRetentionDays: number;
  encryptionConfigured: boolean;
  nextRunAt: string | null;
  lastAutomaticBackupDate: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  lastBackupName: string | null;
  oss: {
    enabled: boolean;
    region: string;
    endpoint: string;
    bucket: string;
    prefix: string;
    hasAccessKeyId: boolean;
    hasSecretAccessKey: boolean;
  };
  r2: {
    enabled: boolean;
    accountId: string;
    bucket: string;
    prefix: string;
    hasAccessKeyId: boolean;
    hasSecretAccessKey: boolean;
  };
}

export interface BackupConfigurationUpdate {
  automaticEnabled: boolean;
  scheduleTime: string;
  localRetentionDays: number;
  remoteRetentionDays: number;
  ossEnabled: boolean;
  ossRegion: string;
  ossEndpoint: string;
  ossBucket: string;
  ossPrefix: string;
  ossAccessKeyId?: string;
  ossAccessKeySecret?: string;
  clearOssCredentials?: boolean;
  r2Enabled: boolean;
  r2AccountId: string;
  r2Bucket: string;
  r2Prefix: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  clearR2Credentials?: boolean;
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

export function getBackupConfiguration(accessToken: string): Promise<BackupConfiguration> {
  return requestJson<BackupConfiguration>("/admin/system/backups/configuration", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function updateBackupConfiguration(
  accessToken: string,
  configuration: BackupConfigurationUpdate,
): Promise<BackupConfiguration> {
  return requestJson<BackupConfiguration>("/admin/system/backups/configuration", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(configuration),
  });
}

export function testBackupProvider(
  accessToken: string,
  provider: "oss" | "r2",
): Promise<{ success: true; provider: "oss" | "r2" }> {
  return requestJson("/admin/system/backups/providers/test", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ provider }),
  });
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
