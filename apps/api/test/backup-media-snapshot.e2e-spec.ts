import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("deletes a media snapshot with its database backup", async () => {
    const snapshotPath = join(root, `${backupName}.media.tar.gz`);
    await writeFile(join(root, backupName), "database");
    await writeFile(snapshotPath, "media-files");

    await service.deleteBackup(backupName);

    await expect(stat(join(root, backupName))).rejects.toThrow();
    await expect(stat(snapshotPath)).rejects.toThrow();
  });
});
