import type { StorageCategoryKey } from "./storage-management.types";
import type { RemoteProvider } from "./system-status.types";

export interface MediaBackupJobResponse {
  id: number;
  status: "pending" | "running" | "completed" | "partial" | "failed";
  trigger: "manual" | "scheduled";
  triggeredById: number | null;
  providers: RemoteProvider[];
  totalFiles: number;
  processedFiles: number;
  uploadedFiles: number;
  reusedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  totalBytes: number;
  uploadedBytes: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface MediaBackupManifestResponse {
  id: number;
  fileId: number;
  category: StorageCategoryKey;
  storedName: string;
  sourceLabel: string;
  provider: RemoteProvider;
  status: "pending" | "uploaded" | "reused" | "skipped" | "failed";
  contentHash: string;
  sizeBytes: number;
  bucket: string | null;
  objectKey: string | null;
  etag: string | null;
  error: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MediaBackupJobLogResponse {
  id: number;
  level: "info" | "warning" | "error";
  event: string;
  message: string;
  fileId: number | null;
  provider: RemoteProvider | null;
  attempt: number | null;
  createdAt: string;
}

export interface MediaBackupJobDetailResponse extends MediaBackupJobResponse {
  manifests: MediaBackupManifestResponse[];
  logs: MediaBackupJobLogResponse[];
}

export interface MediaBackupJobListResponse {
  items: MediaBackupJobResponse[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface MediaBackupFileResponse {
  id: number;
  category: StorageCategoryKey;
  storedName: string;
  sourceType: string;
  sourceId: string | null;
  sourceLabel: string;
  sizeBytes: number;
  contentHash: string | null;
  fileUpdatedAt: string | null;
  lastSeenAt: string;
  lastBackedUpAt: string | null;
}

export interface MediaBackupFileListResponse {
  items: MediaBackupFileResponse[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface StorageFileRepairResponse {
  id: number;
  issueId: number | null;
  category: StorageCategoryKey;
  storedName: string;
  action: "remote_restore" | "reupload" | "confirm_unrecoverable";
  status: "running" | "completed" | "failed";
  provider: RemoteProvider | null;
  manifestId: number | null;
  actorId: number | null;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  expectedHash: string | null;
  actualHash: string | null;
  note: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}
