export interface SystemStatusResponse {
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
    latestMigration: {
      name: string;
      finishedAt: string | null;
    } | null;
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
    latest: {
      name: string;
      sizeBytes: number;
      updatedAt: string;
    } | null;
    items: Array<{
      name: string;
      sizeBytes: number;
      updatedAt: string;
    }>;
  };
  containerRuntime: {
    connected: false;
    message: string;
  };
}

export interface DatabaseBackupResponse {
  name: string;
  sizeBytes: number;
  updatedAt: string;
}
