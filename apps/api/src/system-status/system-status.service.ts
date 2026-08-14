import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { BackupService } from "./backup.service";
import { LightweightMonitoringService } from "./lightweight-monitoring.service";
import { ReliabilityOverviewService } from "./reliability-overview.service";
import { StorageManagementService } from "./storage-management.service";
import { UpdateBackupConfigurationDto } from "./dto/backup.dto";
import {
  BackupConfigurationResponse,
  BackupRestorePreflightResponse,
  DatabaseBackupResponse,
  RemoteProvider,
  SystemStatusResponse,
} from "./system-status.types";

interface DatabaseVersionRow {
  version: string;
}

interface DatabaseSizeRow {
  sizeBytes: unknown;
}

interface MigrationCountRow {
  migrationCount: unknown;
}

interface MigrationRow {
  migrationName: string;
  finishedAt: Date | string | null;
}

@Injectable()
export class SystemStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly backups: BackupService,
    private readonly storageManagement: StorageManagementService,
    private readonly monitoring: LightweightMonitoringService,
    private readonly reliabilityOverview: ReliabilityOverviewService,
  ) {}

  async getStatus(): Promise<SystemStatusResponse> {
    const memory = process.memoryUsage();
    const [database, redis, storage, backups, monitoring, storageOverview] = await Promise.all([
      this.databaseStatus(),
      this.redisStatus(),
      this.storageManagement.getStatusStorageSummary(),
      this.backupStatus(),
      this.monitoring.getSnapshot(),
      this.storageManagement.getOverview(),
    ]);
    const reliability = await this.reliabilityOverview.getOverview(
      monitoring.recentErrors.length,
      storageOverview,
    );

    return {
      generatedAt: new Date().toISOString(),
      application: {
        status: "ok",
        service: "lingxi-api",
        nodeVersion: process.version,
        environment: process.env.NODE_ENV ?? "development",
        uptimeSeconds: Math.floor(process.uptime()),
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
          externalBytes: memory.external,
        },
      },
      database,
      redis,
      storage,
      backups,
      monitoring,
      reliability,
      containerRuntime: {
        connected: false,
        message: "为避免授予 Web API 宿主机控制权限，容器状态请在 1Panel 或 SSH 中查看。",
      },
    };
  }

  async createBackup(): Promise<DatabaseBackupResponse> {
    return this.backups.createBackup();
  }

  getBackupConfiguration(): Promise<BackupConfigurationResponse> {
    return this.backups.getConfiguration();
  }

  updateBackupConfiguration(dto: UpdateBackupConfigurationDto): Promise<BackupConfigurationResponse> {
    return this.backups.updateConfiguration(dto);
  }

  testBackupProvider(provider: RemoteProvider): Promise<{ success: true; provider: RemoteProvider }> {
    return this.backups.testProvider(provider);
  }

  async getBackupDownload(rawName: string): Promise<{
    name: string;
    filePath: string;
    sizeBytes: number;
    mimeType: string;
  }> {
    return this.backups.getBackupDownload(rawName);
  }

  async deleteBackup(rawName: string): Promise<{ success: true }> {
    return this.backups.deleteBackup(rawName);
  }

  getRestorePreflight(rawName: string): Promise<BackupRestorePreflightResponse> {
    return this.backups.getRestorePreflight(rawName);
  }

  verifyBackup(rawName: string): Promise<DatabaseBackupResponse> {
    return this.backups.verifyBackup(rawName);
  }

  async restoreBackup(
    rawName: string,
    confirmation: string,
  ): Promise<{
    success: true;
    restored: string;
    safetyBackup: DatabaseBackupResponse;
    warning: string | null;
    storageScanId: number | null;
  }> {
    return this.backups.restoreBackup(rawName, confirmation);
  }

  private async databaseStatus(): Promise<SystemStatusResponse["database"]> {
    const startedAt = performance.now();
    try {
      const [versionRows, sizeRows, migrationCountRows, migrationRows] = await Promise.all([
        this.prisma.$queryRawUnsafe<DatabaseVersionRow[]>("SELECT VERSION() AS version"),
        this.prisma.$queryRawUnsafe<DatabaseSizeRow[]>(
          "SELECT COALESCE(SUM(data_length + index_length), 0) AS sizeBytes FROM information_schema.tables WHERE table_schema = DATABASE()",
        ),
        this.prisma.$queryRawUnsafe<MigrationCountRow[]>(
          "SELECT COUNT(*) AS migrationCount FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
        ),
        this.prisma.$queryRawUnsafe<MigrationRow[]>(
          "SELECT migration_name AS migrationName, finished_at AS finishedAt FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1",
        ),
      ]);
      const latestMigration = migrationRows[0];
      return {
        connected: true,
        latencyMs: this.elapsedMilliseconds(startedAt),
        version: versionRows[0]?.version ?? null,
        sizeBytes: this.numericValue(sizeRows[0]?.sizeBytes),
        migrationCount: this.numericValue(migrationCountRows[0]?.migrationCount),
        latestMigration: latestMigration ? {
          name: latestMigration.migrationName,
          finishedAt: latestMigration.finishedAt
            ? new Date(latestMigration.finishedAt).toISOString()
            : null,
        } : null,
        error: null,
      };
    } catch {
      return {
        connected: false,
        latencyMs: this.elapsedMilliseconds(startedAt),
        version: null,
        sizeBytes: null,
        migrationCount: null,
        latestMigration: null,
        error: "MySQL 状态读取失败。",
      };
    }
  }

  private async redisStatus(): Promise<SystemStatusResponse["redis"]> {
    const startedAt = performance.now();
    try {
      const [pong, info, keyCount] = await Promise.all([
        this.redis.ping(),
        this.redis.info(),
        this.redis.dbsize(),
      ]);
      if (pong !== "PONG") {
        throw new Error("Unexpected Redis ping response.");
      }
      const values = this.parseRedisInfo(info);
      return {
        connected: true,
        latencyMs: this.elapsedMilliseconds(startedAt),
        version: values.get("redis_version") ?? null,
        keyCount,
        usedMemoryBytes: this.numericValue(values.get("used_memory")),
        maxMemoryBytes: this.numericValue(values.get("maxmemory")),
        connectedClients: this.numericValue(values.get("connected_clients")),
        error: null,
      };
    } catch {
      return {
        connected: false,
        latencyMs: this.elapsedMilliseconds(startedAt),
        version: null,
        keyCount: null,
        usedMemoryBytes: null,
        maxMemoryBytes: null,
        connectedClients: null,
        error: "Redis 状态读取失败。",
      };
    }
  }

  private async backupStatus(): Promise<SystemStatusResponse["backups"]> {
    return this.backups.getStatus();
  }

  private parseRedisInfo(info: string): Map<string, string> {
    const values = new Map<string, string>();
    for (const line of info.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf(":");
      if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
    }
    return values;
  }

  private numericValue(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private elapsedMilliseconds(startedAt: number): number {
    return Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10);
  }
}
