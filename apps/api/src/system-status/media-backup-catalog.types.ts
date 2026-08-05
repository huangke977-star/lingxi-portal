import type { StorageCategoryKey } from "./storage-management.types";

export interface MediaBackupCatalogFile {
  category: StorageCategoryKey;
  storedName: string;
  mimeType: string | null;
  sourceType: string;
  sourceId: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  uploadedBy: string | null;
  sizeBytes: number;
  fileUpdatedAt: Date;
}

export interface MediaBackupCatalogSyncResult {
  synchronizedAt: Date;
  totalFiles: number;
  staleFiles: number;
  invalidatedHashes: number;
  categories: Array<{
    category: StorageCategoryKey;
    fileCount: number;
  }>;
}
