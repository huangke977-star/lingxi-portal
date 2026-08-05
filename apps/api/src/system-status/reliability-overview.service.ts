import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  MediaBackupJobStatus,
  UserNotificationChannel,
  UserNotificationType,
  UserStatus,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { StorageOverviewResponse } from "./storage-management.types";
import type { ReliabilityOverview } from "./system-status.types";

const ALERT_CHECK_INTERVAL_MS = 60_000;
const ANOMALY_WINDOW_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class ReliabilityOverviewService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReliabilityOverviewService.name);
  private alertTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    setTimeout(
      () => void this.notifyLatestMediaBackupFailure(),
      15_000,
    ).unref();
    this.alertTimer = setInterval(
      () => void this.notifyLatestMediaBackupFailure(),
      ALERT_CHECK_INTERVAL_MS,
    );
    this.alertTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.alertTimer) clearInterval(this.alertTimer);
  }

  async getOverview(
    recentApiErrorCount: number,
    storage: StorageOverviewResponse,
  ): Promise<ReliabilityOverview> {
    const latestScanStartedAt = storage.latestScan?.startedAt
      ? new Date(storage.latestScan.startedAt)
      : null;
    const catalogWhere = latestScanStartedAt
      ? { lastSeenAt: { gte: latestScanStartedAt } }
      : {};
    const anomalyWindowStart = new Date(Date.now() - ANOMALY_WINDOW_MS);
    const [
      totalFiles,
      backedUpFiles,
      lastMediaSuccess,
      databaseConfiguration,
      mediaBackupFailures,
    ] = await Promise.all([
      this.prisma.mediaBackupFile.count({ where: catalogWhere }),
      this.prisma.mediaBackupFile.count({
        where: { ...catalogWhere, lastBackedUpAt: { not: null } },
      }),
      this.prisma.mediaBackupJob.findFirst({
        where: {
          status: MediaBackupJobStatus.completed,
          completedAt: { not: null },
        },
        orderBy: [{ completedAt: "desc" }, { id: "desc" }],
        select: { completedAt: true },
      }),
      this.prisma.backupConfiguration.findUnique({
        where: { id: 1 },
        select: { lastSuccessAt: true, lastFailureAt: true },
      }),
      this.prisma.mediaBackupJob.count({
        where: {
          status: {
            in: [MediaBackupJobStatus.failed, MediaBackupJobStatus.partial],
          },
          createdAt: { gte: anomalyWindowStart },
        },
      }),
    ]);
    const mediaSuccessAt = lastMediaSuccess?.completedAt ?? null;
    const databaseSuccessAt = databaseConfiguration?.lastSuccessAt ?? null;
    const lastSuccessfulBackup = this.latestBackup(
      mediaSuccessAt,
      databaseSuccessAt,
    );
    const databaseBackupFailure =
      databaseConfiguration?.lastFailureAt &&
      (!databaseSuccessAt ||
        databaseConfiguration.lastFailureAt.getTime() >
          databaseSuccessAt.getTime())
        ? 1
        : 0;
    const usedPercent = storage.latestScan?.summary?.disk.usedPercent ?? null;
    const diskPressure =
      usedPercent !== null &&
      usedPercent >= storage.configuration.warningThresholdPercent
        ? 1
        : 0;
    const backupFailures = mediaBackupFailures + databaseBackupFailure;
    const totalAnomalies =
      backupFailures +
      diskPressure +
      storage.openIssues.total +
      recentApiErrorCount;

    return {
      backupCoverage: {
        totalFiles,
        backedUpFiles,
        uncoveredFiles: Math.max(0, totalFiles - backedUpFiles),
        percentage:
          totalFiles > 0
            ? Math.round((backedUpFiles / totalFiles) * 1_000) / 10
            : null,
      },
      lastSuccessfulBackupAt: lastSuccessfulBackup.at?.toISOString() ?? null,
      lastSuccessfulBackupSource: lastSuccessfulBackup.source,
      anomalyWindowHours: ANOMALY_WINDOW_MS / 3_600_000,
      anomalies: {
        total: totalAnomalies,
        backupFailures,
        diskPressure,
        missingFiles: storage.openIssues.missing,
        orphanFiles: storage.openIssues.orphan,
        metadataMismatches: storage.openIssues.metadataMismatch,
        recentApiErrors: recentApiErrorCount,
      },
      storage: {
        latestScanAt:
          storage.latestScan?.completedAt ??
          storage.latestScan?.startedAt ??
          null,
        diskUsedPercent: usedPercent,
        warningThresholdPercent: storage.configuration.warningThresholdPercent,
      },
    };
  }

  async notifyLatestMediaBackupFailure(): Promise<void> {
    try {
      const job = await this.prisma.mediaBackupJob.findFirst({
        where: {
          status: {
            in: [MediaBackupJobStatus.failed, MediaBackupJobStatus.partial],
          },
        },
        orderBy: { id: "desc" },
        select: {
          id: true,
          status: true,
          failedFiles: true,
          error: true,
        },
      });
      if (!job) return;
      const actionUrl = `/admin/system?mediaBackupJob=${job.id}`;
      const existing = await this.prisma.userNotification.findFirst({
        where: {
          type: UserNotificationType.system,
          actionUrl,
        },
        select: { id: true },
      });
      if (existing) return;
      const administrators = await this.prisma.user.findMany({
        where: { isSuperAdmin: true, status: UserStatus.active },
        select: { id: true },
      });
      if (!administrators.length) return;
      const state =
        job.status === MediaBackupJobStatus.partial ? "部分失败" : "失败";
      const detail = job.error || `${job.failedFiles} 个文件处理失败`;
      await this.prisma.userNotification.createMany({
        data: administrators.map(({ id }) => ({
          userId: id,
          type: UserNotificationType.system,
          channel: UserNotificationChannel.system,
          title: `媒体备份任务${state}`,
          body: `任务 #${job.id} ${state}：${detail}`.slice(0, 500),
          actionUrl,
        })),
      });
    } catch (error) {
      this.logger.warn(
        `Media backup alert check failed: ${this.errorMessage(error)}`,
      );
    }
  }

  private latestBackup(
    media: Date | null,
    database: Date | null,
  ): { at: Date | null; source: "media" | "database" | null } {
    if (media && (!database || media.getTime() >= database.getTime())) {
      return { at: media, source: "media" };
    }
    if (database) return { at: database, source: "database" };
    return { at: null, source: null };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error && error.message
      ? error.message
      : "Unknown error";
  }
}
