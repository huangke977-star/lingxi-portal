import { PrismaService } from "../src/prisma/prisma.service";
import { ReliabilityOverviewService } from "../src/system-status/reliability-overview.service";
import type { StorageOverviewResponse } from "../src/system-status/storage-management.types";

describe("reliability overview and alerts (e2e)", () => {
  it("combines backup coverage, latest success, and current anomalies", async () => {
    const mediaSuccess = new Date("2026-08-05T08:00:00.000Z");
    const databaseSuccess = new Date("2026-08-05T09:00:00.000Z");
    const prisma = {
      mediaBackupFile: {
        count: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
          where.lastBackedUpAt ? 12 : 20,
        ),
      },
      mediaBackupJob: {
        findFirst: jest.fn(async () => ({ completedAt: mediaSuccess })),
        count: jest.fn(async () => 2),
      },
      backupConfiguration: {
        findUnique: jest.fn(async () => ({
          lastSuccessAt: databaseSuccess,
          lastFailureAt: new Date("2026-08-05T10:00:00.000Z"),
        })),
      },
    } as unknown as PrismaService;
    const service = new ReliabilityOverviewService(prisma);

    const overview = await service.getOverview(4, storageOverview());

    expect(overview.backupCoverage).toEqual({
      totalFiles: 20,
      backedUpFiles: 12,
      uncoveredFiles: 8,
      percentage: 60,
    });
    expect(overview.lastSuccessfulBackupAt).toBe(databaseSuccess.toISOString());
    expect(overview.lastSuccessfulBackupSource).toBe("database");
    expect(overview.anomalies).toMatchObject({
      total: 11,
      backupFailures: 3,
      diskPressure: 1,
      missingFiles: 1,
      recentApiErrors: 4,
    });
  });

  it("notifies active super administrators once for a failed media backup job", async () => {
    const createMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      mediaBackupJob: {
        findFirst: jest.fn(async () => ({
          id: 17,
          status: "failed",
          failedFiles: 2,
          error: "Remote upload failed",
        })),
      },
      userNotification: {
        findFirst: jest.fn(async () => null),
        createMany,
      },
      user: { findMany: jest.fn(async () => [{ id: 1 }]) },
    } as unknown as PrismaService;
    const service = new ReliabilityOverviewService(prisma);

    await service.notifyLatestMediaBackupFailure();

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: 1,
          title: "媒体备份任务失败",
          actionUrl: "/admin/system?mediaBackupJob=17",
        }),
      ],
    });
  });
});

function storageOverview(): StorageOverviewResponse {
  return {
    configuration: {
      automaticScanEnabled: true,
      scanTime: "04:00",
      timezone: "Asia/Shanghai",
      trashRetentionDays: 7,
      warningThresholdPercent: 75,
      nextRunAt: null,
      lastScheduledScanDate: null,
      lastScanAt: "2026-08-05T07:00:00.000Z",
      lastWarningAt: null,
    },
    latestScan: {
      id: 4,
      status: "completed",
      trigger: "scheduled",
      triggeredById: null,
      summary: {
        generatedAt: "2026-08-05T07:00:00.000Z",
        disk: {
          capacityBytes: 1_000,
          usedBytes: 800,
          availableBytes: 200,
          usedPercent: 80,
        },
        totalBytes: 200,
        totalFiles: 20,
        referencedCount: 20,
        healthyCount: 17,
        missingCount: 1,
        orphanCount: 1,
        mismatchCount: 1,
        protectedTemporaryCount: 0,
        trashCount: 0,
        trashBytes: 0,
        categories: [],
      },
      error: null,
      startedAt: "2026-08-05T06:59:00.000Z",
      completedAt: "2026-08-05T07:00:00.000Z",
    },
    openIssues: { missing: 1, orphan: 1, metadataMismatch: 1, total: 3 },
    trash: { count: 0, sizeBytes: 0, expiredCount: 0 },
  };
}
