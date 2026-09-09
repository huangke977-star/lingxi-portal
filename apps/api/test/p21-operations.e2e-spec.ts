import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { P21OperationsService } from "../src/system-status/p21-operations.service";
import { SystemStatusService } from "../src/system-status/system-status.service";

const users = [
  { id: 1, username: "admin", nickname: "超级管理员", email: "admin@example.com", status: "active", isSuperAdmin: true, isAdministrator: false },
  { id: 2, username: "manager", nickname: "普通管理员", email: "manager@example.com", status: "active", isSuperAdmin: false, isAdministrator: true },
] as const;

function prismaMock() {
  return {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) => {
        const user = users.find((item) => item.id === where.id);
        return user ? {
          ...user,
          role: { code: "qi_refining", name: "练气", level: 10 },
          appearanceThemeId: "cloud-blue",
          customAccent: "#1814f0",
          customSurface: "#ffffff",
          customForeground: "#2b2530",
          customMuted: "#665867",
          cardAlpha: 50,
          glassBlur: 18,
          glassTint: "#fff3f6",
          glassTintAlpha: 0,
          avatarStoredName: null,
          avatarMimeType: null,
          profileBio: "",
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        } : null;
      }),
    },
  };
}

describe("P21 operational resilience endpoints (e2e)", () => {
  let app: INestApplication;
  let jwt: JwtService;
  const systemStatusMock = {
    deleteBackups: jest.fn(async (names: string[]) => ({ success: true, deletedCount: names.length })),
  };
  const serviceMock = {
    getOverview: jest.fn(async () => ({ generatedAt: "2026-09-09T00:00:00.000Z", auditPolicy: { cleanupEnabled: true, businessDays: 180, securityDays: 365, serverDays: 90, lastCleanupAt: null, lastCleanupCount: 0 }, alerts: [], runs: [], dependencyAssessment: { generatedAt: "2026-09-09T00:00:00.000Z", source: "package-manifests", items: [] }, recoveryTargets: [], externalStorage: { ossConfigured: false, r2Configured: false, encryptionConfigured: false, message: "待配置" } })),
    listRuns: jest.fn(async () => []),
    listAlerts: jest.fn(async () => []),
    runAlertCheck: jest.fn(async () => ({ id: 1, kind: "alert_check", status: "passed", provider: null, summary: "ok" })),
    runDependencyReview: jest.fn(async () => ({ id: 4, kind: "dependency_review", status: "passed", provider: null, summary: "ok" })),
    startRecoveryDrill: jest.fn(async (_actorId: number, dto: { provider: string }) => ({ id: 2, kind: "recovery_drill", status: dto.provider === "local" ? "passed" : "blocked", provider: dto.provider, summary: "ok" })),
    acknowledgeAlert: jest.fn(async () => ({ id: 3, status: "acknowledged" })),
    resolveAlert: jest.fn(async () => ({ id: 3, status: "resolved" })),
    getAuditPolicy: jest.fn(async () => ({ cleanupEnabled: true, businessDays: 180, securityDays: 365, serverDays: 90, lastCleanupAt: null, lastCleanupCount: 0 })),
    updateAuditPolicy: jest.fn(async (dto: object) => ({ ...dto, lastCleanupAt: null, lastCleanupCount: 0 })),
    cleanupAuditLogs: jest.fn(async () => ({ deletedCount: 0, policy: { cleanupEnabled: true, businessDays: 180, securityDays: 365, serverDays: 90, lastCleanupAt: null, lastCleanupCount: 0 } })),
  };

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = "p21-test-access-secret";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prismaMock())
      .overrideProvider(SystemStatusService).useValue(systemStatusMock)
      .overrideProvider(P21OperationsService).useValue(serviceMock)
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
    return jwt.signAsync({ sub: userId, username: users.find((user) => user.id === userId)?.username }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: "15m" });
  }

  it("restricts the P21 console to super administrators", async () => {
    await request(app.getHttpServer()).get("/admin/system/operations/overview").set("Authorization", `Bearer ${await tokenFor(2)}`).expect(403);
    await request(app.getHttpServer()).get("/admin/system/operations/overview").set("Authorization", `Bearer ${await tokenFor(1)}`).expect(200).expect(({ body }) => expect(body).toMatchObject({ auditPolicy: { businessDays: 180 }, externalStorage: { ossConfigured: false } }));
  });

  it("records alert checks, local drills, and blocks invalid provider input", async () => {
    await request(app.getHttpServer()).post("/admin/system/operations/runs/alert-check").set("Authorization", `Bearer ${await tokenFor(1)}`).expect(201);
    await request(app.getHttpServer()).post("/admin/system/operations/runs/dependency-review").set("Authorization", `Bearer ${await tokenFor(1)}`).expect(201);
    await request(app.getHttpServer()).post("/admin/system/operations/recovery-drills").set("Authorization", `Bearer ${await tokenFor(1)}`).send({ provider: "local" }).expect(201);
    await request(app.getHttpServer()).post("/admin/system/operations/recovery-drills").set("Authorization", `Bearer ${await tokenFor(1)}`).send({ provider: "ftp" }).expect(400);
    expect(serviceMock.runAlertCheck).toHaveBeenCalledWith(1);
    expect(serviceMock.runDependencyReview).toHaveBeenCalledWith(1);
    expect(serviceMock.startRecoveryDrill).toHaveBeenCalledWith(1, { provider: "local" });
  });

  it("validates audit retention policy limits", async () => {
    await request(app.getHttpServer()).post("/admin/system/operations/audit-policy").set("Authorization", `Bearer ${await tokenFor(1)}`).send({ cleanupEnabled: true, businessDays: 1, securityDays: 365, serverDays: 90 }).expect(400);
    await request(app.getHttpServer()).post("/admin/system/operations/audit-policy").set("Authorization", `Bearer ${await tokenFor(1)}`).send({ cleanupEnabled: true, businessDays: 200, securityDays: 400, serverDays: 90 }).expect(201);
    await request(app.getHttpServer()).post("/admin/system/operations/audit-cleanup").set("Authorization", `Bearer ${await tokenFor(1)}`).expect(201);
    expect(serviceMock.updateAuditPolicy).toHaveBeenCalledWith({ cleanupEnabled: true, businessDays: 200, securityDays: 400, serverDays: 90 });
    expect(serviceMock.cleanupAuditLogs).toHaveBeenCalledTimes(1);
  });

  it("validates and forwards batch backup deletion", async () => {
    const names = ["backup-a.sql.gz", "backup-b.sql.gz"];
    await request(app.getHttpServer()).post("/admin/system/backups/batch-delete").set("Authorization", `Bearer ${await tokenFor(1)}`).send({ names }).expect(201).expect(({ body }) => expect(body).toEqual({ success: true, deletedCount: 2 }));
    await request(app.getHttpServer()).post("/admin/system/backups/batch-delete").set("Authorization", `Bearer ${await tokenFor(1)}`).send({ names: [] }).expect(400);
    expect(systemStatusMock.deleteBackups).toHaveBeenCalledWith(names);
  });
});
