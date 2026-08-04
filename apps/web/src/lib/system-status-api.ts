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

export type StorageCategoryKey = "backgrounds" | "site-assets" | "android-releases" | "avatars" | "articles" | "chat";
export type StorageIssueKind = "missing" | "orphan" | "metadata_mismatch";

export interface StorageCategorySummary {
  key: StorageCategoryKey;
  label: string;
  available: boolean;
  sizeBytes: number;
  fileCount: number;
  referencedCount: number;
  healthyCount: number;
  missingCount: number;
  orphanCount: number;
  mismatchCount: number;
  protectedTemporaryCount: number;
  trashCount: number;
  trashBytes: number;
}

export interface StorageScanSummary {
  generatedAt: string;
  disk: {
    capacityBytes: number | null;
    usedBytes: number | null;
    availableBytes: number | null;
    usedPercent: number | null;
  };
  totalBytes: number;
  totalFiles: number;
  referencedCount: number;
  healthyCount: number;
  missingCount: number;
  orphanCount: number;
  mismatchCount: number;
  protectedTemporaryCount: number;
  trashCount: number;
  trashBytes: number;
  categories: StorageCategorySummary[];
}

export interface StorageScan {
  id: number;
  status: "running" | "completed" | "failed";
  trigger: "manual" | "scheduled";
  triggeredById: number | null;
  summary: StorageScanSummary | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface StorageManagementConfiguration {
  automaticScanEnabled: boolean;
  scanTime: string;
  timezone: string;
  trashRetentionDays: number;
  warningThresholdPercent: number;
  nextRunAt: string | null;
  lastScheduledScanDate: string | null;
  lastScanAt: string | null;
  lastWarningAt: string | null;
}

export interface StorageOverview {
  configuration: StorageManagementConfiguration;
  latestScan: StorageScan | null;
  openIssues: {
    missing: number;
    orphan: number;
    metadataMismatch: number;
    total: number;
  };
  trash: {
    count: number;
    sizeBytes: number;
    expiredCount: number;
  };
}

export interface StorageIssue {
  id: number;
  scanId: number;
  kind: StorageIssueKind;
  category: StorageCategoryKey;
  categoryLabel: string;
  storedName: string;
  mimeType: string | null;
  expectedSizeBytes: number | null;
  actualSizeBytes: number | null;
  sourceType: string;
  sourceId: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  uploadedBy: string | null;
  fileUpdatedAt: string | null;
  previewable: boolean;
  canTrash: boolean;
  createdAt: string;
}

export interface StorageIssueList {
  items: StorageIssue[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  scan: StorageScan | null;
}

export interface StorageTrashItem {
  id: number;
  category: StorageCategoryKey;
  categoryLabel: string;
  originalStoredName: string;
  mimeType: string | null;
  sizeBytes: number;
  trashedById: number | null;
  deletedAt: string;
  purgeAfter: string;
}

export interface StorageTrashList {
  items: StorageTrashItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function getSystemStatus(accessToken: string): Promise<SystemStatus> {
  return requestJson<SystemStatus>("/admin/system/status", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getStorageOverview(accessToken: string): Promise<StorageOverview> {
  return requestJson<StorageOverview>("/admin/system/storage", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function startStorageScan(accessToken: string): Promise<StorageScan> {
  return requestJson<StorageScan>("/admin/system/storage/scans", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getStorageScan(accessToken: string, id: number): Promise<StorageScan> {
  return requestJson<StorageScan>(`/admin/system/storage/scans/${id}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function listStorageIssues(
  accessToken: string,
  query: { page?: number; pageSize?: number; kind?: StorageIssueKind | ""; category?: StorageCategoryKey | ""; q?: string },
): Promise<StorageIssueList> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.kind) params.set("kind", query.kind);
  if (query.category) params.set("category", query.category);
  if (query.q?.trim()) params.set("q", query.q.trim());
  return requestJson<StorageIssueList>(`/admin/system/storage/issues?${params.toString()}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getStorageIssueFile(accessToken: string, id: number): Promise<Blob> {
  return requestBlob(`/admin/system/storage/issues/${id}/file`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function trashStorageIssue(accessToken: string, id: number): Promise<StorageTrashItem> {
  return requestJson<StorageTrashItem>(`/admin/system/storage/issues/${id}/trash`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function listStorageTrash(
  accessToken: string,
  query: { page?: number; pageSize?: number; category?: StorageCategoryKey | "" },
): Promise<StorageTrashList> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.category) params.set("category", query.category);
  return requestJson<StorageTrashList>(`/admin/system/storage/trash?${params.toString()}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function restoreStorageTrash(accessToken: string, id: number): Promise<{ success: true }> {
  return requestJson(`/admin/system/storage/trash/${id}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function deleteStorageTrash(accessToken: string, id: number): Promise<{ success: true }> {
  return requestJson(`/admin/system/storage/trash/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function updateStorageConfiguration(
  accessToken: string,
  input: Pick<StorageManagementConfiguration, "automaticScanEnabled" | "scanTime" | "trashRetentionDays" | "warningThresholdPercent">,
): Promise<StorageManagementConfiguration> {
  return requestJson<StorageManagementConfiguration>("/admin/system/storage/configuration", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
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
