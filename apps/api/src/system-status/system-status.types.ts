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
  backups: BackupStatusResponse;
  containerRuntime: {
    connected: false;
    message: string;
  };
}

export interface DatabaseBackupResponse {
  name: string;
  sizeBytes: number;
  updatedAt: string;
  remoteResults?: RemoteBackupResult[];
  warning?: string | null;
}

export type RemoteProvider = "oss" | "r2";

export interface RemoteBackupResult {
  provider: RemoteProvider;
  status: "success" | "failed";
  objectKey: string | null;
  error: string | null;
}

export interface BackupStatusResponse {
  available: boolean;
  totalBytes: number;
  fileCount: number;
  latest: DatabaseBackupResponse | null;
  items: DatabaseBackupResponse[];
}

export interface BackupProviderConfigurationResponse {
  enabled: boolean;
  bucket: string;
  prefix: string;
  hasAccessKeyId: boolean;
  hasSecretAccessKey: boolean;
}

export interface BackupConfigurationResponse {
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
  oss: BackupProviderConfigurationResponse & {
    region: string;
    endpoint: string;
  };
  r2: BackupProviderConfigurationResponse & {
    accountId: string;
  };
}
