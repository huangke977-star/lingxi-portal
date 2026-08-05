import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { BackupOperationLockService } from "../src/system-status/backup-operation-lock.service";
import { BackupService } from "../src/system-status/backup.service";
import { MediaBackupService } from "../src/system-status/media-backup.service";
import { StorageManagementService } from "../src/system-status/storage-management.service";
import { SystemStatusService } from "../src/system-status/system-status.service";

const users = [
  {
    id: 1,
    username: "admin",
    nickname: "HLOVET 主理人",
    email: "admin@example.com",
    status: "active",
    isSuperAdmin: true,
    role: { code: "administrator", name: "管理员", level: 90 },
  },
  {
    id: 2,
    username: "manager",
    nickname: "普通管理员",
    email: "manager@example.com",
    status: "active",
    isSuperAdmin: false,
    role: { code: "administrator", name: "管理员", level: 90 },
  },
] as const;

function prismaMock() {
  return {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) => {
        const user = users.find((item) => item.id === where.id);
        return user ? {
          ...user,
          appearanceThemeId: "sakura-mist",
          customAccent: "#db2777",
          customSurface: "#ffffff",
          customForeground: "#2b2530",
          customMuted: "#665867",
          cardAlpha: 52,
          glassBlur: 22,
          glassTint: "#fff3f6",
          glassTintAlpha: 72,
          avatarStoredName: null,
          avatarMimeType: null,
          profileBio: "保持简单。",
          createdAt: new Date("2026-07-31T00:00:00.000Z"),
        } : null;
      }),
    },
  };
}

const statusResponse = {
  generatedAt: "2026-07-31T06:00:00.000Z",
  application: {
    status: "ok" as const,
    service: "lingxi-api",
    nodeVersion: "v22.0.0",
    environment: "test",
    uptimeSeconds: 120,
    memory: { rssBytes: 1024, heapUsedBytes: 512, heapTotalBytes: 768, externalBytes: 32 },
  },
  database: {
    connected: true,
    latencyMs: 2,
    version: "8.4.0",
    sizeBytes: 4096,
    migrationCount: 12,
    latestMigration: { name: "latest", finishedAt: "2026-07-31T05:00:00.000Z" },
    error: null,
  },
  redis: {
    connected: true,
    latencyMs: 1,
    version: "7.2.5",
    keyCount: 8,
    usedMemoryBytes: 2048,
    maxMemoryBytes: 4096,
    connectedClients: 2,
    error: null,
  },
  storage: { totalBytes: 1024, totalFiles: 1, items: [] },
  backups: { available: true, totalBytes: 512, fileCount: 1, latest: null, items: [] },
  monitoring: {
    retentionMinutes: 1440,
    slowRequestThresholdMs: 1000,
    slowRequests: [],
    recentErrors: [],
    memoryTrend: [],
    diskTrend: [],
  },
  reliability: {
    backupCoverage: {
      totalFiles: 20,
      backedUpFiles: 12,
      uncoveredFiles: 8,
      percentage: 60,
    },
    lastSuccessfulBackupAt: "2026-07-31T05:30:00.000Z",
    lastSuccessfulBackupSource: "media" as const,
    anomalyWindowHours: 24,
    anomalies: {
      total: 3,
      backupFailures: 1,
      diskPressure: 0,
      missingFiles: 1,
      orphanFiles: 0,
      metadataMismatches: 0,
      recentApiErrors: 1,
    },
    storage: {
      latestScanAt: "2026-07-31T05:00:00.000Z",
      diskUsedPercent: 62,
      warningThresholdPercent: 75,
    },
  },
  containerRuntime: { connected: false as const, message: "Use 1Panel or SSH." },
};

const backupConfigurationResponse = {
  automaticEnabled: true,
  scheduleTime: "03:00",
  timezone: "Asia/Shanghai",
  localRetentionDays: 7,
  remoteRetentionDays: 90,
  encryptionConfigured: true,
  nextRunAt: "2026-08-04T19:00:00.000Z",
  lastAutomaticBackupDate: null,
  lastMediaBackupDate: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureMessage: null,
  lastBackupName: null,
  oss: { enabled: false, region: "", endpoint: "", bucket: "", prefix: "database", hasAccessKeyId: false, hasSecretAccessKey: false },
  r2: { enabled: false, accountId: "", bucket: "", prefix: "database", hasAccessKeyId: false, hasSecretAccessKey: false },
};

describe("system status administration (e2e)", () => {
  let app: INestApplication;
  let jwt: JwtService;
  const serviceMock = {
    getStatus: jest.fn(async () => statusResponse),
    getBackupConfiguration: jest.fn(async () => backupConfigurationResponse),
    updateBackupConfiguration: jest.fn(async () => backupConfigurationResponse),
    testBackupProvider: jest.fn(async (provider: "oss" | "r2") => ({ success: true as const, provider })),
    createBackup: jest.fn(async () => ({ name: "manual-20260803_120000.sql.gz", sizeBytes: 512, updatedAt: "2026-08-03T12:00:00.000Z" })),
    deleteBackup: jest.fn(async () => ({ success: true })),
    restoreBackup: jest.fn(async (name: string) => ({ success: true, restored: name, safetyBackup: { name: "pre-restore.sql.gz", sizeBytes: 512, updatedAt: "2026-08-03T12:00:00.000Z" } })),
  };
  const storageServiceMock = {
    getOverview: jest.fn(async () => ({
      configuration: { automaticScanEnabled: true, scanTime: "04:00", timezone: "Asia/Shanghai", trashRetentionDays: 7, warningThresholdPercent: 75, nextRunAt: null, lastScheduledScanDate: null, lastScanAt: null, lastWarningAt: null },
      latestScan: null,
      openIssues: { missing: 0, orphan: 0, metadataMismatch: 0, total: 0 },
      trash: { count: 0, sizeBytes: 0, expiredCount: 0 },
    })),
    startScan: jest.fn(async (userId: number) => ({ id: 3, status: "running", trigger: "manual", triggeredById: userId, summary: null, error: null, startedAt: "2026-08-04T06:00:00.000Z", completedAt: null })),
    getScan: jest.fn(async (id: number) => ({ id, status: "completed", trigger: "manual", triggeredById: 1, summary: null, error: null, startedAt: "2026-08-04T06:00:00.000Z", completedAt: "2026-08-04T06:00:01.000Z" })),
    listIssues: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0, scan: null })),
    listTrash: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 })),
    getConfiguration: jest.fn(async () => ({ automaticScanEnabled: true, scanTime: "04:00", timezone: "Asia/Shanghai", trashRetentionDays: 7, warningThresholdPercent: 75, nextRunAt: null, lastScheduledScanDate: null, lastScanAt: null, lastWarningAt: null })),
    updateConfiguration: jest.fn(async () => ({ automaticScanEnabled: false, scanTime: "05:00", timezone: "Asia/Shanghai", trashRetentionDays: 14, warningThresholdPercent: 80, nextRunAt: null, lastScheduledScanDate: null, lastScanAt: null, lastWarningAt: null })),
    getIssueFile: jest.fn(),
    trashIssue: jest.fn(async () => ({ id: 1 })),
    restoreTrash: jest.fn(async () => ({ success: true })),
    deleteTrash: jest.fn(async () => ({ success: true })),
  };
  const mediaBackupServiceMock = {
    startBackup: jest.fn(async (userId: number) => ({
      id: 9,
      status: "pending",
      triggeredById: userId,
    })),
    listJobs: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 })),
    getJob: jest.fn(async (id: number) => ({ id, status: "completed", manifests: [], logs: [] })),
    listFiles: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 })),
    restoreFile: jest.fn(async (id: number) => ({ success: true, file: { id } })),
    restoreMissingIssue: jest.fn(async (id: number) => ({ id, action: "remote_restore", status: "completed" })),
    reuploadMissingIssue: jest.fn(async (id: number) => ({ id, action: "reupload", status: "completed" })),
    confirmMissingIssueUnrecoverable: jest.fn(async (id: number) => ({ id, action: "confirm_unrecoverable", status: "completed" })),
    listIssueRepairs: jest.fn(async () => []),
  };

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = "test-access-token-secret";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock())
      .overrideProvider(SystemStatusService)
      .useValue(serviceMock)
      .overrideProvider(StorageManagementService)
      .useValue(storageServiceMock)
      .overrideProvider(MediaBackupService)
      .useValue(mediaBackupServiceMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  async function tokenFor(userId: number): Promise<string> {
    const user = users.find((item) => item.id === userId);
    if (!user) throw new Error(`Missing user ${userId}`);
    return jwt.signAsync(
      { sub: user.id, username: user.username },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: "15m" },
    );
  }

  it("allows only the super administrator to read system status", async () => {
    await request(app.getHttpServer())
      .get("/admin/system/status")
      .set("Authorization", `Bearer ${await tokenFor(2)}`)
      .expect(403);

    const response = await request(app.getHttpServer())
      .get("/admin/system/status")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .expect(200);

    expect(response.body).toMatchObject({
      application: { service: "lingxi-api", status: "ok" },
      database: { connected: true, migrationCount: 12 },
      redis: { connected: true, keyCount: 8 },
      reliability: {
        backupCoverage: { percentage: 60, uncoveredFiles: 8 },
        anomalies: { total: 3 },
      },
      containerRuntime: { connected: false },
    });
  });

  it("allows only the super administrator to create, restore, and delete backups", async () => {
    const name = "manual-20260803_120000.sql.gz";
    await request(app.getHttpServer())
      .post("/admin/system/backups")
      .set("Authorization", `Bearer ${await tokenFor(2)}`)
      .expect(403);

    await request(app.getHttpServer())
      .post("/admin/system/backups")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/admin/system/backups/${name}/restore`)
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .send({ confirmation: name })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/admin/system/backups/${name}`)
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .expect(200);

    expect(serviceMock.createBackup).toHaveBeenCalledTimes(1);
    expect(serviceMock.restoreBackup).toHaveBeenCalledWith(name, name);
    expect(serviceMock.deleteBackup).toHaveBeenCalledWith(name);
  });

  it("allows only the super administrator to configure and test remote backups", async () => {
    await request(app.getHttpServer())
      .get("/admin/system/backups/configuration")
      .set("Authorization", `Bearer ${await tokenFor(2)}`)
      .expect(403);

    await request(app.getHttpServer())
      .get("/admin/system/backups/configuration")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ scheduleTime: "03:00", oss: { enabled: false } }));

    await request(app.getHttpServer())
      .post("/admin/system/backups/providers/test")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .send({ provider: "r2" })
      .expect(201);

    expect(serviceMock.testBackupProvider).toHaveBeenCalledWith("r2");
  });

  it("requires the complete backup filename before restore starts", async () => {
    const service = new BackupService(
      {} as PrismaService,
      {} as never,
      {} as never,
      new BackupOperationLockService(),
    );
    await expect(service.restoreBackup("manual-20260803_120000.sql.gz", "manual"))
      .rejects.toThrow("请输入完整备份文件名确认恢复操作。");
  });

  it("allows only the super administrator to inspect and start storage scans", async () => {
    await request(app.getHttpServer())
      .get("/admin/system/storage")
      .set("Authorization", `Bearer ${await tokenFor(2)}`)
      .expect(403);

    await request(app.getHttpServer())
      .get("/admin/system/storage")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ openIssues: { total: 0 }, trash: { count: 0 } }));

    await request(app.getHttpServer())
      .post("/admin/system/storage/scans")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ id: 3, status: "running", triggeredById: 1 }));

    expect(storageServiceMock.startScan).toHaveBeenCalledWith(1);
  });

  it("validates storage policy limits", async () => {
    await request(app.getHttpServer())
      .post("/admin/system/storage/configuration")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .send({ automaticScanEnabled: true, scanTime: "25:90", trashRetentionDays: 0, warningThresholdPercent: 99 })
      .expect(400);

    await request(app.getHttpServer())
      .post("/admin/system/storage/configuration")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .send({ automaticScanEnabled: false, scanTime: "05:00", trashRetentionDays: 14, warningThresholdPercent: 80 })
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ automaticScanEnabled: false, trashRetentionDays: 14 }));
  });

  it("exposes media backup and repair endpoints only to the super administrator", async () => {
    await request(app.getHttpServer())
      .post("/admin/system/media-backups/jobs")
      .set("Authorization", `Bearer ${await tokenFor(2)}`)
      .expect(403);

    await request(app.getHttpServer())
      .post("/admin/system/media-backups/jobs")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ id: 9, triggeredById: 1 }));

    await request(app.getHttpServer())
      .get("/admin/system/media-backups/jobs?page=1&pageSize=10")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .expect(200);

    await request(app.getHttpServer())
      .post("/admin/system/storage/issues/7/restore-remote")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .send({ provider: "oss" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/admin/system/storage/issues/7/confirm-unrecoverable")
      .set("Authorization", `Bearer ${await tokenFor(1)}`)
      .send({ note: "源文件无法重新取得" })
      .expect(201);

    expect(mediaBackupServiceMock.startBackup).toHaveBeenCalledWith(1);
    expect(mediaBackupServiceMock.restoreMissingIssue).toHaveBeenCalledWith(7, 1, "oss");
    expect(mediaBackupServiceMock.confirmMissingIssueUnrecoverable).toHaveBeenCalledWith(
      7,
      1,
      "源文件无法重新取得",
    );
  });
});
