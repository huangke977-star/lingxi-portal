import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { BackupService } from "../src/system-status/backup.service";
import { P22QualityService } from "../src/system-status/p22-quality.service";
import { StorageManagementService } from "../src/system-status/storage-management.service";

describe("P22 production quality checks (e2e)", () => {
  it("passes local checks while keeping unconfigured remote storage blocked", async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ value: 1 }])
        .mockResolvedValueOnce([{ total: 42, failed: 0 }])
        .mockResolvedValueOnce([]),
      operationalRun: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 22,
        kind: data.kind as string,
        status: data.status as string,
        provider: null,
        summary: data.summary as string,
        detail: data.detail,
        metrics: data.metrics,
        actorId: data.actorId as number,
        startedAt: data.startedAt as Date,
        completedAt: data.completedAt as Date,
        createdAt: data.startedAt as Date,
      })) },
    } as unknown as PrismaService;
    const redis = { ping: jest.fn().mockResolvedValue("PONG") } as unknown as RedisService;
    const backups = { getConfiguration: jest.fn().mockResolvedValue({
      oss: { enabled: false, hasAccessKeyId: false, hasSecretAccessKey: false },
      r2: { enabled: false, hasAccessKeyId: false, hasSecretAccessKey: false },
    }) } as unknown as BackupService;
    const storage = { getOverview: jest.fn().mockResolvedValue({ openIssues: { total: 0 } }) } as unknown as StorageManagementService;
    const service = new P22QualityService(prisma, redis, backups, storage);

    const result = await service.runQualityCheck(1);

    expect(result.status).toBe("passed");
    expect(result.summary).toContain("远端对象存储仍等待外部配置");
    expect((result.detail as { blocked: boolean }).blocked).toBe(true);
    expect((result.metrics as { passed: number }).passed).toBe(4);
  });
});
