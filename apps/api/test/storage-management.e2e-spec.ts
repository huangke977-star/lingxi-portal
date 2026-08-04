import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageIssueKind, StorageScanStatus } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { StorageManagementService } from "../src/system-status/storage-management.service";

describe("storage management scanning (e2e)", () => {
  let root: string;
  let service: StorageManagementService;
  let prisma: ReturnType<typeof prismaMock>;

  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    root = await mkdtemp(join(tmpdir(), "hlovet-storage-"));
    const paths = {
      BACKGROUND_UPLOAD_DIR: join(root, "backgrounds"),
      SITE_ASSET_UPLOAD_DIR: join(root, "site-assets"),
      ANDROID_RELEASE_UPLOAD_DIR: join(root, "android-releases"),
      AVATAR_UPLOAD_DIR: join(root, "avatars"),
      ARTICLE_UPLOAD_DIR: join(root, "articles"),
      CHAT_UPLOAD_DIR: join(root, "chat"),
    };
    for (const [key, value] of Object.entries(paths)) {
      process.env[key] = value;
      await mkdir(value, { recursive: true });
    }
    await writeFile(join(paths.ARTICLE_UPLOAD_DIR, "orphan.png"), Buffer.from("orphan"));
    await writeFile(join(paths.ARTICLE_UPLOAD_DIR, "mismatch.png"), Buffer.from("actual-size"));
    await mkdir(join(paths.ARTICLE_UPLOAD_DIR, ".tmp"), { recursive: true });
    await writeFile(join(paths.ARTICLE_UPLOAD_DIR, ".tmp", "fresh.upload"), Buffer.from("uploading"));

    prisma = prismaMock();
    service = new StorageManagementService(prisma as unknown as PrismaService);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("detects missing, orphaned, mismatched, and protected temporary files", async () => {
    const scan = await service.startScan(1);
    const completed = await waitForScan(service, scan.id);

    expect(completed.status).toBe(StorageScanStatus.completed);
    expect(completed.summary).toMatchObject({
      missingCount: 1,
      orphanCount: 1,
      mismatchCount: 1,
      protectedTemporaryCount: 1,
    });

    const issues = await service.listIssues({ page: 1, pageSize: 20 });
    expect(issues.items.map((item) => item.kind).sort()).toEqual([
      StorageIssueKind.metadata_mismatch,
      StorageIssueKind.missing,
      StorageIssueKind.orphan,
    ].sort());
    expect(issues.items.find((item) => item.kind === StorageIssueKind.orphan)?.storedName).toBe("orphan.png");
  });

  it("moves only orphan files through trash and restores them", async () => {
    const scan = await service.startScan(1);
    await waitForScan(service, scan.id);
    const issues = await service.listIssues({ page: 1, pageSize: 20, kind: "orphan" });
    const orphan = issues.items[0];
    expect(orphan).toBeDefined();

    const trashed = await service.trashIssue(orphan.id, 1);
    await expect(stat(join(root, "articles", "orphan.png"))).rejects.toThrow();
    expect((await service.listTrash({ page: 1, pageSize: 20 })).items).toHaveLength(1);

    await service.restoreTrash(trashed.id);
    expect((await stat(join(root, "articles", "orphan.png"))).isFile()).toBe(true);
    expect((await service.listTrash({ page: 1, pageSize: 20 })).items).toHaveLength(0);
  });
});

async function waitForScan(service: StorageManagementService, id: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const scan = await service.getScan(id);
    if (scan.status !== StorageScanStatus.running) return scan;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Storage scan did not finish.");
}

function prismaMock() {
  const now = new Date("2026-08-04T06:00:00.000Z");
  const configuration = {
    id: 1,
    automaticScanEnabled: true,
    scanTime: "04:00",
    timezone: "Asia/Shanghai",
    trashRetentionDays: 7,
    warningThresholdPercent: 75,
    lastScheduledScanDate: null as string | null,
    lastScanAt: null as Date | null,
    lastWarningAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const scans: Array<Record<string, unknown>> = [];
  const issues: Array<Record<string, unknown>> = [];
  const trash: Array<Record<string, unknown>> = [];
  let scanId = 0;
  let issueId = 0;
  let trashId = 0;

  const storageScan = {
    findFirst: jest.fn(async ({ where }: { where?: { status?: string } } = {}) => {
      const filtered = where?.status ? scans.filter((item) => item.status === where.status) : scans;
      return filtered.at(-1) ?? null;
    }),
    findUnique: jest.fn(async ({ where }: { where: { id: number } }) => scans.find((item) => item.id === where.id) ?? null),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: ++scanId, summary: null, error: null, startedAt: new Date(), completedAt: null, createdAt: new Date(), ...data };
      scans.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
      const row = scans.find((item) => item.id === where.id);
      if (!row) throw new Error("Missing scan");
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async () => ({ count: 0 })),
    findMany: jest.fn(async () => []),
    deleteMany: jest.fn(async () => ({ count: 0 })),
  };

  const storageScanIssue = {
    createMany: jest.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
      for (const item of data) issues.push({ id: ++issueId, resolvedAt: null, resolution: null, createdAt: new Date(), ...item });
      return { count: data.length };
    }),
    findMany: jest.fn(async ({ where, skip = 0, take = 20 }: { where: Record<string, unknown>; skip?: number; take?: number }) => filterIssues(issues, where).slice(skip, skip + take)),
    count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => filterIssues(issues, where).length),
    findUnique: jest.fn(async ({ where }: { where: { id: number } }) => issues.find((item) => item.id === where.id) ?? null),
    update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
      const row = issues.find((item) => item.id === where.id);
      if (!row) throw new Error("Missing issue");
      Object.assign(row, data);
      return row;
    }),
  };

  const storageTrashItem = {
    findMany: jest.fn(async ({ where, skip = 0, take = 100 }: { where?: { purgeAfter?: { lte: Date }; category?: string }; skip?: number; take?: number } = {}) => trash.filter((item) => !where?.category || item.category === where.category).slice(skip, skip + take)),
    count: jest.fn(async ({ where }: { where?: { category?: string; purgeAfter?: { lte: Date } } } = {}) => trash.filter((item) => !where?.category || item.category === where.category).length),
    aggregate: jest.fn(async () => ({ _count: { _all: trash.length }, _sum: { sizeBytes: trash.reduce((total, item) => total + Number(item.sizeBytes), 0) || null } })),
    findUnique: jest.fn(async ({ where }: { where: { id: number } }) => trash.find((item) => item.id === where.id) ?? null),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: ++trashId, deletedAt: new Date(), createdAt: new Date(), ...data };
      trash.push(row);
      return row;
    }),
    delete: jest.fn(async ({ where }: { where: { id: number } }) => {
      const index = trash.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error("Missing trash");
      return trash.splice(index, 1)[0];
    }),
  };

  const mock: Record<string, unknown> = {
    backgroundImage: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    siteAsset: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    androidRelease: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    user: {
      findMany: jest.fn(async ({ where }: { where?: { isSuperAdmin?: boolean } } = {}) => where?.isSuperAdmin ? [] : []),
      findUnique: jest.fn(async () => null),
    },
    articleImage: {
      findMany: jest.fn(async () => [
        { id: 1, originalName: "missing.png", storedName: "missing.png", mimeType: "image/png", sizeBytes: 100, article: { title: "Missing image", slug: "missing-image", author: { username: "author" } } },
        { id: 2, originalName: "mismatch.png", storedName: "mismatch.png", mimeType: "image/png", sizeBytes: 100, article: { title: "Mismatch image", slug: "mismatch-image", author: { username: "author" } } },
      ]),
      findUnique: jest.fn(async ({ where }: { where: { storedName: string } }) => where.storedName === "mismatch.png" || where.storedName === "missing.png" ? { id: 1 } : null),
    },
    chatAttachment: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    storageManagementConfiguration: {
      upsert: jest.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => Object.assign(configuration, create, update)),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(configuration, data)),
    },
    storageScan,
    storageScanIssue,
    storageTrashItem,
    userNotification: { createMany: jest.fn(async () => ({ count: 0 })) },
  };
  mock.$transaction = jest.fn(async (action: (transaction: unknown) => Promise<unknown>): Promise<unknown> => action(mock));
  return mock;
}

function filterIssues(items: Array<Record<string, unknown>>, where: Record<string, unknown>) {
  return items.filter((item) => {
    if (where.scanId !== undefined && item.scanId !== where.scanId) return false;
    if (where.kind !== undefined && item.kind !== where.kind) return false;
    if (where.category !== undefined && item.category !== where.category) return false;
    if (where.resolvedAt === null && item.resolvedAt !== null) return false;
    return true;
  });
}
