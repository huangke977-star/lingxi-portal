import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageIssueKind, StorageScanStatus } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { MediaBackupCatalogService } from "../src/system-status/media-backup-catalog.service";
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
    const mediaBackupCatalog = new MediaBackupCatalogService(prisma as unknown as PrismaService);
    service = new StorageManagementService(prisma as unknown as PrismaService, mediaBackupCatalog);
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

  it("catalogs referenced files from all six persistent media categories", async () => {
    const fixtures = [
      ["BACKGROUND_UPLOAD_DIR", "background.webp", "backgrounds"],
      ["SITE_ASSET_UPLOAD_DIR", "logo.png", "site-assets"],
      ["ANDROID_RELEASE_UPLOAD_DIR", "release.apk", "android-releases"],
      ["AVATAR_UPLOAD_DIR", "avatar.webp", "avatars"],
      ["ARTICLE_UPLOAD_DIR", "article.png", "articles"],
      ["CHAT_UPLOAD_DIR", "attachment.bin", "chat"],
    ] as const;
    for (const [environmentKey, storedName] of fixtures) {
      await writeFile(
        join(process.env[environmentKey]!, storedName),
        Buffer.from(storedName),
      );
    }
    prisma.backgroundImage.findMany.mockResolvedValueOnce([
      {
        id: 1,
        originalName: "background.webp",
        storedName: "background.webp",
        mimeType: "image/webp",
        sizeBytes: 15,
        isActive: true,
        uploadedBy: { username: "admin" },
      },
    ]);
    prisma.siteAsset.findMany.mockResolvedValueOnce([
      {
        id: 2,
        kind: "logo",
        originalName: "logo.png",
        storedName: "logo.png",
        mimeType: "image/png",
        sizeBytes: 8,
        uploadedBy: { username: "admin" },
      },
    ]);
    prisma.androidRelease.findMany.mockResolvedValueOnce([
      {
        id: 3,
        versionName: "1.0.0",
        originalName: "release.apk",
        storedName: "release.apk",
        mimeType: "application/vnd.android.package-archive",
        sizeBytes: 11,
        uploadedBy: { username: "admin" },
      },
    ]);
    prisma.user.findMany.mockResolvedValueOnce([
      {
        id: 4,
        username: "member",
        nickname: "Member",
        avatarStoredName: "avatar.webp",
        avatarMimeType: "image/webp",
        avatarSizeBytes: 11,
      },
    ]);
    prisma.articleImage.findMany.mockResolvedValueOnce([
      {
        id: 5,
        originalName: "article.png",
        storedName: "article.png",
        mimeType: "image/png",
        sizeBytes: 11,
        article: {
          title: "Article",
          slug: "article",
          author: { username: "member" },
        },
      },
    ]);
    prisma.chatAttachment.findMany.mockResolvedValueOnce([
      {
        id: 6,
        conversationId: 1,
        messageId: 1,
        originalName: "attachment.bin",
        storedName: "attachment.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 14,
        uploadedBy: { username: "member" },
      },
    ]);

    const scan = await service.startScan(1);
    const completed = await waitForScan(service, scan.id);

    expect(completed.status).toBe(StorageScanStatus.completed);
    const catalogedCategories = prisma.mediaBackupFile.upsert.mock.calls.map(
      ([call]) => call.create.category,
    );
    expect(new Set(catalogedCategories)).toEqual(
      new Set(fixtures.map((fixture) => fixture[2])),
    );
  });

  it("does not report a generated thumbnail for a healthy chat attachment as orphaned", async () => {
    const storedName = "attachment.png";
    const original = Buffer.from("chat-image");
    await writeFile(join(process.env.CHAT_UPLOAD_DIR!, storedName), original);
    await writeFile(join(process.env.CHAT_UPLOAD_DIR!, `${storedName}.thumb.webp`), Buffer.from("thumbnail"));
    prisma.chatAttachment.findMany.mockResolvedValueOnce([{
      id: 61,
      conversationId: 9,
      messageId: 17,
      storedName,
      originalName: "图片.png",
      mimeType: "image/png",
      sizeBytes: original.length,
      uploadedBy: { username: "tester" },
    }]);

    const scan = await service.startScan(1);
    const completed = await waitForScan(service, scan.id);

    expect(completed.summary?.categories.find((category) => category.key === "chat")).toMatchObject({
      fileCount: 2,
      healthyCount: 1,
      orphanCount: 0,
    });
  });

  it("treats managed topic covers as referenced article media", async () => {
    const storedName = "topic-00000000-0000-4000-8000-000000000001.webp";
    await mkdir(join(process.env.ARTICLE_UPLOAD_DIR!, "topic-covers"), { recursive: true });
    await writeFile(
      join(process.env.ARTICLE_UPLOAD_DIR!, "topic-covers", storedName),
      Buffer.from("topic-cover"),
    );
    prisma.articleTopic.findMany.mockResolvedValueOnce([{
      id: 7,
      title: "夏日专题",
      coverOriginalName: "summer.webp",
      coverStoredName: storedName,
      coverMimeType: "image/webp",
      coverSizeBytes: 11,
      updatedBy: { username: "admin" },
    }]);

    const scan = await service.startScan(1);
    const completed = await waitForScan(service, scan.id);

    expect(completed.status).toBe(StorageScanStatus.completed);
    expect(completed.summary?.categories.find((item) => item.key === "articles"))
      .toMatchObject({ healthyCount: 1 });
    expect(prisma.mediaBackupFile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        category: "articles",
        storedName: `topic-covers/${storedName}`,
        sourceType: "topic_cover",
      }),
    }));
  });

  it("invalidates the previous hash when a cataloged file changes", async () => {
    const firstScan = await service.startScan(1);
    await waitForScan(service, firstScan.id);
    const [catalogedFile] = await prisma.mediaBackupFile.findMany();
    expect(catalogedFile).toBeDefined();
    Object.assign(catalogedFile, {
      contentHash: "a".repeat(64),
      lastBackedUpAt: new Date("2026-08-04T08:00:00.000Z"),
    });

    const filePath = join(process.env.ARTICLE_UPLOAD_DIR!, "mismatch.png");
    await writeFile(filePath, Buffer.from("changed-content"));
    const changedAt = new Date(Date.now() + 10_000);
    await utimes(filePath, changedAt, changedAt);

    const secondScan = await service.startScan(1);
    await waitForScan(service, secondScan.id);
    const latestUpsert = prisma.mediaBackupFile.upsert.mock.calls.at(-1)?.[0];
    expect(latestUpsert?.update).toMatchObject({
      contentHash: null,
      lastBackedUpAt: null,
    });
  });

  it("notifies only when the missing-file count changes", async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 1 }]);
    const firstScan = await service.startScan(1);
    await waitForScan(service, firstScan.id);
    expect(prisma.userNotification.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.userNotification.createMany).toHaveBeenLastCalledWith({
      data: [
        expect.objectContaining({
          title: "缺失文件数量发生变化",
          actionUrl: `/admin/storage?scan=${firstScan.id}`,
        }),
      ],
    });

    const unchangedScan = await service.startScan(1);
    await waitForScan(service, unchangedScan.id);
    expect(prisma.userNotification.createMany).toHaveBeenCalledTimes(1);

    await writeFile(
      join(process.env.ARTICLE_UPLOAD_DIR!, "missing.png"),
      Buffer.alloc(100),
    );
    const recoveredScan = await service.startScan(1);
    await waitForScan(service, recoveredScan.id);
    expect(prisma.userNotification.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.userNotification.createMany).toHaveBeenLastCalledWith({
      data: [
        expect.objectContaining({
          body: expect.stringContaining("由 1 个变为 0 个"),
        }),
      ],
    });
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
  const mediaBackupFiles: Array<Record<string, unknown>> = [];
  let scanId = 0;
  let issueId = 0;
  let trashId = 0;

  const storageScan = {
    findFirst: jest.fn(async ({ where }: { where?: { status?: string; id?: { lt?: number } } } = {}) => {
      const filtered = scans.filter((item) => {
        if (where?.status && item.status !== where.status) return false;
        if (where?.id?.lt && Number(item.id) >= where.id.lt) return false;
        return true;
      });
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

  const mediaBackupFile = {
    findMany: jest.fn(async () => mediaBackupFiles),
    upsert: jest.fn(
      async ({ where, create, update }: {
        where: {
          category_storedName: { category: string; storedName: string };
        };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = where.category_storedName;
        const existing = mediaBackupFiles.find(
          (item) =>
            item.category === key.category &&
            item.storedName === key.storedName,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = {
          id: mediaBackupFiles.length + 1,
          contentHash: null,
          lastBackedUpAt: null,
          ...create,
        };
        mediaBackupFiles.push(created);
        return created;
      },
    ),
  };

  const mock = {
    backgroundImage: {
      findMany: jest.fn(
        async (): Promise<Array<Record<string, unknown>>> => [],
      ),
      findUnique: jest.fn(async () => null),
    },
    siteAsset: {
      findMany: jest.fn(
        async (): Promise<Array<Record<string, unknown>>> => [],
      ),
      findUnique: jest.fn(async () => null),
    },
    androidRelease: {
      findMany: jest.fn(
        async (): Promise<Array<Record<string, unknown>>> => [],
      ),
      findUnique: jest.fn(async () => null),
    },
    user: {
      findMany: jest.fn(
        async (
          { where }: { where?: { isSuperAdmin?: boolean } } = {},
        ): Promise<Array<Record<string, unknown>>> =>
          where?.isSuperAdmin ? [] : [],
      ),
      findUnique: jest.fn(async () => null),
    },
    articleImage: {
      findMany: jest.fn(async () => [
        { id: 1, originalName: "missing.png", storedName: "missing.png", mimeType: "image/png", sizeBytes: 100, article: { title: "Missing image", slug: "missing-image", author: { username: "author" } } },
        { id: 2, originalName: "mismatch.png", storedName: "mismatch.png", mimeType: "image/png", sizeBytes: 100, article: { title: "Mismatch image", slug: "mismatch-image", author: { username: "author" } } },
      ]),
      findUnique: jest.fn(async ({ where }: { where: { storedName: string } }) => where.storedName === "mismatch.png" || where.storedName === "missing.png" ? { id: 1 } : null),
    },
    articleTopic: {
      findMany: jest.fn(
        async (): Promise<Array<Record<string, unknown>>> => [],
      ),
      findUnique: jest.fn(async () => null),
    },
    chatAttachment: {
      findMany: jest.fn(
        async (): Promise<Array<Record<string, unknown>>> => [],
      ),
      findUnique: jest.fn(async () => null),
    },
    storageManagementConfiguration: {
      upsert: jest.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => Object.assign(configuration, create, update)),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(configuration, data)),
    },
    storageScan,
    storageScanIssue,
    storageTrashItem,
    storageFileRepair: {
      findMany: jest.fn(async () => []),
    },
    mediaBackupFile,
    userNotification: { createMany: jest.fn(async () => ({ count: 0 })) },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(
    async (
      action:
        | Array<Promise<unknown>>
        | ((transaction: unknown) => Promise<unknown>),
    ): Promise<unknown> =>
      Array.isArray(action) ? Promise.all(action) : action(mock),
  );
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
