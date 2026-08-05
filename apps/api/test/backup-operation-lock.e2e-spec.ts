import { PrismaService } from "../src/prisma/prisma.service";
import { BackupOperationLockService } from "../src/system-status/backup-operation-lock.service";
import { BackupService } from "../src/system-status/backup.service";

describe("backup operation lock", () => {
  it("prevents a database backup from overlapping an active media backup", async () => {
    const operationLock = new BackupOperationLockService();
    const release = operationLock.acquire("媒体备份");
    const service = new BackupService(
      {} as PrismaService,
      {} as never,
      {} as never,
      operationLock,
    );

    await expect(service.createBackup()).rejects.toThrow("媒体备份");
    release();
  });

  it("releases the channel only when the current holder finishes", () => {
    const operationLock = new BackupOperationLockService();
    const release = operationLock.acquire("数据库备份");

    expect(() => operationLock.acquire("媒体备份")).toThrow("数据库备份");
    release();
    expect(() => operationLock.acquire("媒体备份")).not.toThrow();
  });
});
