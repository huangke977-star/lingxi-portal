export type StorageCategoryKey =
  | "backgrounds"
  | "site-assets"
  | "android-releases"
  | "avatars"
  | "articles"
  | "chat";

export type StorageIssueKindValue = "missing" | "orphan" | "metadata_mismatch";
export type StorageScanStatusValue = "running" | "completed" | "failed";
export type StorageScanTriggerValue = "manual" | "scheduled";

export interface StorageDiskUsage {
  capacityBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usedPercent: number | null;
}

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
  disk: StorageDiskUsage;
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

export interface StorageScanResponse {
  id: number;
  status: StorageScanStatusValue;
  trigger: StorageScanTriggerValue;
  triggeredById: number | null;
  summary: StorageScanSummary | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface StorageManagementConfigurationResponse {
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

export interface StorageOverviewResponse {
  configuration: StorageManagementConfigurationResponse;
  latestScan: StorageScanResponse | null;
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

export interface StorageIssueResponse {
  id: number;
  scanId: number;
  kind: StorageIssueKindValue;
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

export interface StorageIssueListResponse {
  items: StorageIssueResponse[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  scan: StorageScanResponse | null;
}

export interface StorageTrashItemResponse {
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

export interface StorageTrashListResponse {
  items: StorageTrashItemResponse[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
