import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { BackupService } from "../src/system-status/backup.service";
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

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = "test-access-token-secret";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock())
      .overrideProvider(SystemStatusService)
      .useValue(serviceMock)
      .compile();

    app = moduleRef.createNestApplication();
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
    const service = new BackupService({} as PrismaService, {} as never, {} as never);
    await expect(service.restoreBackup("manual-20260803_120000.sql.gz", "manual"))
      .rejects.toThrow("请输入完整备份文件名确认恢复操作。");
  });
});
