/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MediaBackupJobStatus,
  StorageIssueKind,
} from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { BackupCryptoService } from "../src/system-status/backup-crypto.service";
import { BackupOperationLockService } from "../src/system-status/backup-operation-lock.service";
import { BackupRemoteService } from "../src/system-status/backup-remote.service";
import { MediaBackupService } from "../src/system-status/media-backup.service";

describe("media backup execution and recovery (e2e)", () => {
  let root: string;
  let prisma: ReturnType<typeof prismaMock>;
  let crypto: BackupCryptoService;
  let remote: ReturnType<typeof remoteMock>;
  let service: MediaBackupService;

  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    process.env.BACKUP_ENCRYPTION_KEY = "22".repeat(32);
    process.env.MEDIA_BACKUP_RETRY_DELAY_MS = "0";
    root = await mkdtemp(join(tmpdir(), "hlovet-media-backup-"));
    const directories = {
      BACKGROUND_UPLOAD_DIR: join(root, "backgrounds"),
      SITE_ASSET_UPLOAD_DIR: join(root, "site-assets"),
      ANDROID_RELEASE_UPLOAD_DIR: join(root, "android-releases"),
      AVATAR_UPLOAD_DIR: join(root, "avatars"),
      ARTICLE_UPLOAD_DIR: join(root, "articles"),
      CHAT_UPLOAD_DIR: join(root, "chat"),
    };
    for (const [key, directory] of Object.entries(directories)) {
      process.env[key] = directory;
      await mkdir(directory, { recursive: true });
    }
    prisma = prismaMock();
    crypto = new BackupCryptoService();
    remote = remoteMock(crypto);
    service = new MediaBackupService(
      prisma as unknown as PrismaService,
      crypto,
      remote as unknown as BackupRemoteService,
      new BackupOperationLockService(),
    );
  });

  afterEach(async () => {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    delete process.env.MEDIA_BACKUP_RETRY_DELAY_MS;
    await rm(root, { recursive: true, force: true });
  });

  it("uploads duplicate content once and reuses hashes and manifests on later jobs", async () => {
    await addCatalogFile(prisma, "first.bin", Buffer.from("same-content"));
    await addCatalogFile(prisma, "second.bin", Buffer.from("same-content"));

    const first = await service.startBackup(1);
    const firstCompleted = await waitForJob(service, first.id);

    expect(firstCompleted).toMatchObject({
      status: MediaBackupJobStatus.completed,
      totalFiles: 2,
      processedFiles: 2,
      uploadedFiles: 1,
      reusedFiles: 1,
      failedFiles: 0,
    });
    expect(remote.uploadMedia).toHaveBeenCalledTimes(1);
    expect(
      prisma.state.files.every((file: Record<string, any>) =>
        Boolean(file.contentHash),
      ),
    ).toBe(true);
    expect(
      prisma.state.manifests.map((item: Record<string, any>) => item.status),
    ).toEqual(["uploaded", "reused"]);

    await allowJobCleanup();
    const second = await service.startBackup(1);
    const secondCompleted = await waitForJob(service, second.id);

    expect(secondCompleted).toMatchObject({
      status: MediaBackupJobStatus.completed,
      uploadedFiles: 0,
      reusedFiles: 2,
    });
    expect(remote.uploadMedia).toHaveBeenCalledTimes(1);
    expect(
      prisma.state.logs.filter(
        (item: Record<string, any>) => item.event === "hash.reused",
      ),
    ).toHaveLength(2);
  });

  it("rehashes and uploads a cataloged file when its bytes change", async () => {
    const file = await addCatalogFile(
      prisma,
      "changed.bin",
      Buffer.from("before"),
    );
    const first = await service.startBackup(1);
    await waitForJob(service, first.id);
    const firstHash = file.contentHash;

    const filePath = join(process.env.ARTICLE_UPLOAD_DIR!, file.storedName);
    await writeFile(filePath, Buffer.from("after-content"));
    const changedAt = new Date(Date.now() + 10_000);
    await utimes(filePath, changedAt, changedAt);
    await allowJobCleanup();
    const second = await service.startBackup(1);
    const completed = await waitForJob(service, second.id);

    expect(completed.status).toBe(MediaBackupJobStatus.completed);
    expect(file.contentHash).not.toBe(firstHash);
    expect(remote.uploadMedia).toHaveBeenCalledTimes(2);
  });

  it("records a failed file when it disappears before hashing", async () => {
    const file = await addCatalogFile(
      prisma,
      "missing.bin",
      Buffer.from("gone"),
    );
    await unlink(join(process.env.ARTICLE_UPLOAD_DIR!, file.storedName));

    const job = await service.startBackup(1);
    const completed = await waitForJob(service, job.id);

    expect(completed).toMatchObject({
      status: MediaBackupJobStatus.failed,
      processedFiles: 1,
      failedFiles: 1,
    });
    expect(
      prisma.state.logs.some(
        (item: Record<string, any>) =>
          item.event === "file.failed" && item.message.includes("计算哈希前"),
      ),
    ).toBe(true);
  });

  it("excludes temporary, trash, and unfinished upload records without reading them", async () => {
    prisma.state.files.push(
      catalogRow(1, ".tmp/pending.upload", "article_image"),
      catalogRow(2, ".trash/removed.bin", "article_image"),
      {
        ...catalogRow(3, "pending-chat.bin", "chat_attachment"),
        category: "chat",
        sourceLabel: "会话 #1 · 待发送 · pending-chat.bin",
      },
    );

    const job = await service.startBackup(1);
    const completed = await waitForJob(service, job.id);

    expect(completed).toMatchObject({
      status: MediaBackupJobStatus.completed,
      totalFiles: 3,
      skippedFiles: 3,
      failedFiles: 0,
    });
    expect(remote.uploadMedia).not.toHaveBeenCalled();
  });

  it("retries a failed provider upload up to three attempts", async () => {
    await addCatalogFile(prisma, "retry.bin", Buffer.from("retry-me"));
    const originalUpload = remote.uploadMedia.getMockImplementation()!;
    let attempts = 0;
    remote.uploadMedia.mockImplementation(async (...args) => {
      attempts += 1;
      if (attempts < 3) throw new Error(`temporary-${attempts}`);
      return originalUpload(...args);
    });

    const job = await service.startBackup(1);
    const completed = await waitForJob(service, job.id);

    expect(completed.status).toBe(MediaBackupJobStatus.completed);
    expect(attempts).toBe(3);
    expect(prisma.state.manifests[0]).toMatchObject({
      status: "uploaded",
      attemptCount: 3,
    });
    expect(
      prisma.state.logs.filter(
        (item: Record<string, any>) => item.event === "upload.retry",
      ),
    ).toHaveLength(2);
  });

  it("keeps media backup concurrency at one", async () => {
    await addCatalogFile(prisma, "locked.bin", Buffer.from("wait-for-upload"));
    const originalUpload = remote.uploadMedia.getMockImplementation()!;
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    remote.uploadMedia.mockImplementationOnce(async (...args) => {
      await uploadGate;
      return originalUpload(...args);
    });

    const job = await service.startBackup(1);
    for (
      let attempt = 0;
      attempt < 100 && !remote.uploadMedia.mock.calls.length;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await expect(service.startBackup(1)).rejects.toThrow("正在执行");
    releaseUpload();
    await expect(waitForJob(service, job.id)).resolves.toMatchObject({
      status: MediaBackupJobStatus.completed,
    });
  });

  it("removes expired task history and unreferenced remote objects", async () => {
    const oldDate = new Date(Date.now() - 100 * 86_400_000);
    prisma.state.jobs.push({
      id: 100,
      status: "completed",
      trigger: "scheduled",
      triggeredById: null,
      providers: ["oss"],
      totalFiles: 1,
      processedFiles: 1,
      uploadedFiles: 1,
      reusedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      totalBytes: 8n,
      uploadedBytes: 8n,
      error: null,
      startedAt: oldDate,
      completedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });
    prisma.state.manifests.push({
      id: 100,
      jobId: 100,
      fileId: 100,
      provider: "oss",
      status: "uploaded",
      contentHash: "a".repeat(64),
      sizeBytes: 8,
      bucket: "media-bucket",
      objectKey: "media/sha256/expired.enc",
      etag: null,
      error: null,
      attemptCount: 1,
      lastAttemptAt: oldDate,
      startedAt: oldDate,
      completedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });

    const job = await service.startBackup(1);
    await waitForJob(service, job.id);

    expect(remote.deleteMediaObject).toHaveBeenCalledWith(
      "oss",
      "media/sha256/expired.enc",
      expect.objectContaining({ remoteRetentionDays: 90 }),
    );
    expect(
      prisma.state.jobs.some((item: Record<string, any>) => item.id === 100),
    ).toBe(false);
  });

  it("restores one encrypted file through a temporary file and verifies its hash", async () => {
    const content = Buffer.from("recoverable-media");
    const file = await addCatalogFile(prisma, "restore.bin", content);
    const job = await service.startBackup(1);
    await waitForJob(service, job.id);
    await unlink(join(process.env.ARTICLE_UPLOAD_DIR!, file.storedName));

    const result = await service.restoreFile(file.id, file.storedName, "oss");

    expect(result).toMatchObject({ success: true, provider: "oss" });
    expect(
      await readFile(join(process.env.ARTICLE_UPLOAD_DIR!, file.storedName)),
    ).toEqual(content);
    expect(file.contentHash).toBe(
      createHash("sha256").update(content).digest("hex"),
    );
  });

  it("keeps the current file unchanged when the downloaded backup fails verification", async () => {
    const file = await addCatalogFile(
      prisma,
      "corrupt.bin",
      Buffer.from("backup-version"),
    );
    const job = await service.startBackup(1);
    await waitForJob(service, job.id);
    const manifest = prisma.state.manifests[0];
    remote.objects.set(
      manifest.objectKey,
      Buffer.from("not-an-encrypted-backup"),
    );
    const current = Buffer.from("current-version");
    await writeFile(
      join(process.env.ARTICLE_UPLOAD_DIR!, file.storedName),
      current,
    );

    await expect(
      service.restoreFile(file.id, file.storedName, "oss"),
    ).rejects.toThrow();

    expect(
      await readFile(join(process.env.ARTICLE_UPLOAD_DIR!, file.storedName)),
    ).toEqual(current);
  });

  it("supports remote restore, reupload, and confirmation for missing-file issues", async () => {
    const backedUp = await addCatalogFile(
      prisma,
      "remote.bin",
      Buffer.from("remote-copy"),
    );
    const job = await service.startBackup(1);
    await waitForJob(service, job.id);
    await unlink(join(process.env.ARTICLE_UPLOAD_DIR!, backedUp.storedName));
    const remoteIssue = prisma.addIssue(backedUp.storedName, "11");

    const restored = await service.restoreMissingIssue(
      remoteIssue.id,
      1,
      "oss",
    );
    expect(restored).toMatchObject({
      action: "remote_restore",
      status: "completed",
      provider: "oss",
    });

    const reuploadIssue = prisma.addIssue("replacement.bin", "12");
    const uploadPath = join(root, "replacement.upload");
    await writeFile(uploadPath, Buffer.from("replacement"));
    const reuploaded = await service.reuploadMissingIssue(reuploadIssue.id, 1, {
      originalname: "新文件.bin",
      mimetype: "application/octet-stream",
      path: uploadPath,
      size: 11,
    });
    expect(reuploaded).toMatchObject({
      action: "reupload",
      status: "completed",
    });
    expect(
      await readFile(join(process.env.ARTICLE_UPLOAD_DIR!, "replacement.bin")),
    ).toEqual(Buffer.from("replacement"));

    const unrecoverableIssue = prisma.addIssue("lost-forever.bin", "13");
    const confirmed = await service.confirmMissingIssueUnrecoverable(
      unrecoverableIssue.id,
      1,
      "源文件无法取得",
    );
    expect(confirmed).toMatchObject({
      action: "confirm_unrecoverable",
      status: "completed",
      note: "源文件无法取得",
    });
  });
});

async function addCatalogFile(
  prisma: ReturnType<typeof prismaMock>,
  storedName: string,
  content: Buffer,
) {
  const filePath = join(process.env.ARTICLE_UPLOAD_DIR!, storedName);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content);
  const file = await stat(filePath);
  const row = {
    ...catalogRow(prisma.state.files.length + 1, storedName, "article_image"),
    sizeBytes: file.size,
    fileUpdatedAt: file.mtime,
  };
  prisma.state.files.push(row);
  return row;
}

function catalogRow(id: number, storedName: string, sourceType: string) {
  const now = new Date();
  return {
    id,
    category: "articles",
    storedName,
    mimeType: "application/octet-stream",
    sourceType,
    sourceId: String(id),
    sourceLabel: storedName,
    sourceUrl: null,
    uploadedBy: "admin",
    sizeBytes: 0,
    contentHash: null as string | null,
    fileUpdatedAt: now,
    lastSeenAt: now,
    lastBackedUpAt: null as Date | null,
    createdAt: now,
    updatedAt: now,
  };
}

async function waitForJob(service: MediaBackupService, id: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = await service.getJob(id);
    if (job.status !== "pending" && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Media backup job did not finish.");
}

function allowJobCleanup() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

function remoteMock(crypto: BackupCryptoService) {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    enabledProviders: jest.fn(() => ["oss"]),
    providerBucket: jest.fn(() => "media-bucket"),
    uploadMedia: jest.fn(async (sourcePath: string, contentHash: string) => {
      const objectKey = `media/sha256/${contentHash}.enc`;
      const encrypted = await crypto.encryptFile(sourcePath);
      try {
        objects.set(objectKey, await readFile(encrypted.filePath));
      } finally {
        await encrypted.cleanup();
      }
      return { bucket: "media-bucket", objectKey, etag: `etag-${contentHash}` };
    }),
    downloadMedia: jest.fn(
      async (_provider: string, objectKey: string, destinationPath: string) => {
        const content = objects.get(objectKey);
        if (!content) throw new Error("Remote object missing");
        await writeFile(destinationPath, content, { flag: "wx" });
      },
    ),
    deleteMediaObject: jest.fn(async (_provider: string, objectKey: string) => {
      objects.delete(objectKey);
    }),
  };
}

function prismaMock() {
  const now = new Date();
  const configuration = {
    id: 1,
    automaticEnabled: false,
    scheduleTime: "03:00",
    timezone: "Asia/Shanghai",
    localRetentionDays: 7,
    remoteRetentionDays: 90,
    ossEnabled: true,
    ossRegion: "oss-cn-hangzhou",
    ossEndpoint: null,
    ossBucket: "media-bucket",
    ossPrefix: "database",
    ossAccessKeyIdEncrypted: "encrypted",
    ossAccessKeySecretEncrypted: "encrypted",
    r2Enabled: false,
    r2AccountId: null,
    r2Bucket: null,
    r2Prefix: "database",
    r2AccessKeyIdEncrypted: null,
    r2SecretAccessKeyEncrypted: null,
    lastAutomaticBackupDate: null,
    lastMediaBackupDate: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureMessage: null,
    lastBackupName: null,
    createdAt: now,
    updatedAt: now,
  };
  const state = {
    files: [] as Array<Record<string, any>>,
    jobs: [] as Array<Record<string, any>>,
    manifests: [] as Array<Record<string, any>>,
    logs: [] as Array<Record<string, any>>,
    issues: [] as Array<Record<string, any>>,
    repairs: [] as Array<Record<string, any>>,
  };
  let jobId = 0;
  let manifestId = 0;
  let logId = 0;
  let issueId = 0;
  let repairId = 0;

  const mediaBackupJob = {
    findFirst: jest.fn(
      async ({ where }: any = {}) =>
        state.jobs
          .filter((item) => statusMatches(item, where?.status))
          .at(-1) ?? null,
    ),
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: ++jobId,
        status: "pending",
        triggeredById: null,
        totalFiles: 0,
        processedFiles: 0,
        uploadedFiles: 0,
        reusedFiles: 0,
        skippedFiles: 0,
        failedFiles: 0,
        totalBytes: 0n,
        uploadedBytes: 0n,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      state.jobs.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = state.jobs.find((item) => item.id === where.id);
      if (!row) throw new Error("Missing job");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    findUnique: jest.fn(async ({ where, include }: any) => {
      const row = state.jobs.find((item) => item.id === where.id);
      if (!row) return null;
      if (!include) return row;
      return {
        ...row,
        manifests: state.manifests
          .filter((item) => item.jobId === row.id)
          .map((item) => ({
            ...item,
            file: state.files.find((file) => file.id === item.fileId),
          })),
        logs: state.logs.filter((item) => item.jobId === row.id),
      };
    }),
    findMany: jest.fn(async ({ where }: any = {}) => {
      if (where?.createdAt?.lt) {
        return state.jobs
          .filter(
            (item) =>
              item.id !== where.id?.not && item.createdAt < where.createdAt.lt,
          )
          .map((item) => ({
            id: item.id,
            manifests: state.manifests.filter(
              (manifest) => manifest.jobId === item.id,
            ),
          }));
      }
      return state.jobs;
    }),
    count: jest.fn(async () => state.jobs.length),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const rows = state.jobs.filter(
        (item) =>
          where.id?.in?.includes(item.id) || statusMatches(item, where.status),
      );
      rows.forEach((item) => Object.assign(item, data));
      return { count: rows.length };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const ids = new Set(where.id.in);
      const before = state.jobs.length;
      state.jobs.splice(
        0,
        state.jobs.length,
        ...state.jobs.filter((item) => !ids.has(item.id)),
      );
      return { count: before - state.jobs.length };
    }),
  };

  const mediaBackupFile = {
    findMany: jest.fn(async ({ where }: any = {}) =>
      state.files.filter(
        (item) =>
          !where?.lastSeenAt?.gte || item.lastSeenAt >= where.lastSeenAt.gte,
      ),
    ),
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id)
        return state.files.find((item) => item.id === where.id) ?? null;
      const key = where.category_storedName;
      return (
        state.files.find(
          (item) =>
            item.category === key.category &&
            item.storedName === key.storedName,
        ) ?? null
      );
    }),
    count: jest.fn(async () => state.files.length),
    update: jest.fn(async ({ where, data }: any) => {
      const row = state.files.find((item) => item.id === where.id);
      if (!row) throw new Error("Missing file");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.category_storedName;
      let row = state.files.find(
        (item) =>
          item.category === key.category && item.storedName === key.storedName,
      );
      if (row) Object.assign(row, update, { updatedAt: new Date() });
      else {
        const created = {
          id: state.files.length + 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastBackedUpAt: null,
          ...create,
        };
        state.files.push(created);
        row = created;
      }
      return row;
    }),
  };

  const mediaBackupManifest = {
    findFirst: jest.fn(
      async ({ where }: any) =>
        state.manifests.filter((item) => manifestMatches(item, where)).at(-1) ??
        null,
    ),
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: ++manifestId,
        objectKey: null,
        etag: null,
        error: null,
        attemptCount: 0,
        lastAttemptAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      state.manifests.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = state.manifests.find((item) => item.id === where.id);
      if (!row) throw new Error("Missing manifest");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    aggregate: jest.fn(async ({ where }: any) => ({
      _sum: {
        sizeBytes:
          state.manifests
            .filter((item) => manifestMatches(item, where))
            .reduce((total, item) => total + item.sizeBytes, 0) || null,
      },
    })),
    count: jest.fn(
      async ({ where }: any) =>
        state.manifests.filter((item) => manifestMatches(item, where)).length,
    ),
  };

  const mediaBackupJobLog = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: ++logId, createdAt: new Date(), ...data };
      state.logs.push(row);
      return row;
    }),
    createMany: jest.fn(async ({ data }: any) => {
      data.forEach((item: any) =>
        state.logs.push({ id: ++logId, createdAt: new Date(), ...item }),
      );
      return { count: data.length };
    }),
  };

  const storageScanIssue = {
    findUnique: jest.fn(
      async ({ where }: any) =>
        state.issues.find((item) => item.id === where.id) ?? null,
    ),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const rows = state.issues.filter(
        (item) =>
          item.category === where.category &&
          item.storedName === where.storedName &&
          item.resolvedAt === null,
      );
      rows.forEach((item) => Object.assign(item, data));
      return { count: rows.length };
    }),
  };

  const storageFileRepair = {
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: ++repairId,
        status: "running",
        provider: null,
        manifestId: null,
        originalName: null,
        mimeType: null,
        sizeBytes: null,
        expectedHash: null,
        actualHash: null,
        note: null,
        error: null,
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      state.repairs.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = state.repairs.find((item) => item.id === where.id);
      if (!row) throw new Error("Missing repair");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    findMany: jest.fn(async ({ where }: any) =>
      state.repairs.filter(
        (item) =>
          item.category === where.category &&
          item.storedName === where.storedName,
      ),
    ),
  };

  const mock: any = {
    state,
    addIssue(storedName: string, sourceId: string) {
      const row = {
        id: ++issueId,
        scanId: 1,
        kind: StorageIssueKind.missing,
        category: "articles",
        storedName,
        mimeType: "application/octet-stream",
        expectedSizeBytes: null,
        actualSizeBytes: null,
        sourceType: "article_image",
        sourceId,
        sourceLabel: storedName,
        sourceUrl: null,
        uploadedBy: "admin",
        fileUpdatedAt: null,
        resolvedAt: null,
        resolution: null,
        createdAt: new Date(),
      };
      state.issues.push(row);
      return row;
    },
    backupConfiguration: {
      upsert: jest.fn(async () => configuration),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    storageScan: {
      findFirst: jest.fn(async () => ({
        startedAt: new Date(Date.now() - 60_000),
      })),
    },
    mediaBackupJob,
    mediaBackupFile,
    mediaBackupManifest,
    mediaBackupJobLog,
    storageScanIssue,
    storageFileRepair,
    backgroundImage: { update: jest.fn(async () => ({})) },
    siteAsset: { update: jest.fn(async () => ({})) },
    androidRelease: { update: jest.fn(async () => ({})) },
    user: { update: jest.fn(async () => ({})) },
    articleImage: { update: jest.fn(async () => ({})) },
    chatAttachment: { update: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (action: any) => action(mock)),
  };
  return mock;
}

function statusMatches(item: Record<string, any>, status: any): boolean {
  if (!status) return true;
  if (status.in) return status.in.includes(item.status);
  if (status.not) return item.status !== status.not;
  return item.status === status;
}

function manifestMatches(item: Record<string, any>, where: any): boolean {
  if (where.jobId !== undefined) {
    if (typeof where.jobId === "number" && item.jobId !== where.jobId)
      return false;
    if (where.jobId.notIn?.includes(item.jobId)) return false;
  }
  for (const key of [
    "fileId",
    "provider",
    "contentHash",
    "sizeBytes",
    "bucket",
    "objectKey",
  ]) {
    if (where[key] === undefined) continue;
    if (where[key]?.not === null && item[key] === null) return false;
    else if (typeof where[key] !== "object" && item[key] !== where[key])
      return false;
  }
  if (!statusMatches(item, where.status)) return false;
  return true;
}
