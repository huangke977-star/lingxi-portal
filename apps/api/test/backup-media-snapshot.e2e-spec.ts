import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { PrismaService } from "../src/prisma/prisma.service";
import { BackupOperationLockService } from "../src/system-status/backup-operation-lock.service";
import { BackupService } from "../src/system-status/backup.service";

describe("database backup media snapshots", () => {
  const backupName = "manual-20260814_120000.sql.gz";
  let root = "";
  let originalBackupDirectory: string | undefined;
  let service: BackupService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lingxi-backup-snapshot-"));
    originalBackupDirectory = process.env.BACKUP_DIR;
    process.env.BACKUP_DIR = root;
    service = new BackupService(
      {} as PrismaService,
      {} as never,
      {} as never,
      new BackupOperationLockService(),
    );
  });

  afterEach(async () => {
    if (originalBackupDirectory === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = originalBackupDirectory;
    await rm(root, { force: true, recursive: true });
  });

  it("reports the paired media snapshot as part of local backup usage", async () => {
    await writeFile(join(root, backupName), "database");
    await writeFile(join(root, `${backupName}.media.tar.gz`), "media-files");

    const status = await service.getStatus();

    expect(status.totalBytes).toBe(Buffer.byteLength("database") + Buffer.byteLength("media-files"));
    expect(status.items).toEqual([expect.objectContaining({
      name: backupName,
      mediaSnapshotAvailable: true,
      mediaSnapshotSizeBytes: Buffer.byteLength("media-files"),
    })]);
  });

  it("exposes persisted verification for a paired snapshot", async () => {
    await writeFile(join(root, backupName), "database");
    await writeFile(join(root, `${backupName}.media.tar.gz`), "media-files");
    await writeFile(join(root, `${backupName}.verification.json`), JSON.stringify({
      version: 1,
      status: "verified",
      verifiedAt: "2026-08-14T00:00:00.000Z",
      databaseValid: true,
      mediaValid: true,
      mediaFileCount: 3,
      mediaDirectories: ["backgrounds", "site-assets", "android-releases", "avatars", "articles", "chat"],
      error: null,
    }));

    const status = await service.getStatus();

    expect(status.items[0]?.verification).toEqual(expect.objectContaining({
      status: "verified",
      mediaFileCount: 3,
    }));
  });

  it("keeps legacy backups unverified until they are checked", async () => {
    await writeFile(join(root, backupName), gzipSync("SELECT 1;"));

    const before = await service.getStatus();
    const checked = await service.verifyBackup(backupName);

    expect(before.items[0]?.verification.status).toBe("not_verified");
    expect(checked.verification).toEqual(expect.objectContaining({
      status: "database_only",
      databaseValid: true,
      mediaValid: null,
    }));
  });

  it("blocks restore preflight when a gzip archive is corrupted", async () => {
    await writeFile(join(root, backupName), "not a gzip archive");

    const preflight = await service.getRestorePreflight(backupName);

    expect(preflight.canRestore).toBe(false);
    expect(preflight.backup.verification.status).toBe("failed");
    expect(preflight.warnings.join(" ")).toContain("数据库归档校验失败");
  });

  it("deletes a media snapshot with its database backup", async () => {
    const snapshotPath = join(root, `${backupName}.media.tar.gz`);
    const verificationPath = join(root, `${backupName}.verification.json`);
    await writeFile(join(root, backupName), "database");
    await writeFile(snapshotPath, "media-files");
    await writeFile(verificationPath, "{}");

    await service.deleteBackup(backupName);

    await expect(stat(join(root, backupName))).rejects.toThrow();
    await expect(stat(snapshotPath)).rejects.toThrow();
    await expect(stat(verificationPath)).rejects.toThrow();
  });
});
