import { BackupConfiguration } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { BackupCryptoService } from "../src/system-status/backup-crypto.service";
import { BackupOperationLockService } from "../src/system-status/backup-operation-lock.service";
import { BackupService } from "../src/system-status/backup.service";

function configuration(): BackupConfiguration {
  const now = new Date("2026-08-03T00:00:00.000Z");
  return {
    id: 1,
    automaticEnabled: false,
    scheduleTime: "03:00",
    timezone: "Asia/Shanghai",
    localRetentionDays: 7,
    remoteRetentionDays: 90,
    ossEnabled: false,
    ossRegion: null,
    ossEndpoint: null,
    ossBucket: null,
    ossPrefix: "database",
    ossAccessKeyIdEncrypted: null,
    ossAccessKeySecretEncrypted: null,
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
}

describe("backup configuration", () => {
  const encryptionKey = "11".repeat(32);

  afterEach(() => {
    delete process.env.BACKUP_ENCRYPTION_KEY;
  });

  it("encrypts OSS credentials before storing them", async () => {
    process.env.BACKUP_ENCRYPTION_KEY = encryptionKey;
    let stored = configuration();
    const prisma = {
      backupConfiguration: {
        upsert: jest.fn(async () => stored),
        update: jest.fn(async ({ data }: { data: Partial<BackupConfiguration> }) => {
          stored = { ...stored, ...data, updatedAt: new Date() };
          return stored;
        }),
      },
    } as unknown as PrismaService;
    const crypto = new BackupCryptoService();
    const service = new BackupService(prisma, crypto, {} as never, new BackupOperationLockService());

    const response = await service.updateConfiguration({
      automaticEnabled: true,
      scheduleTime: "04:30",
      localRetentionDays: 14,
      remoteRetentionDays: 120,
      ossEnabled: true,
      ossRegion: "oss-cn-hangzhou",
      ossEndpoint: "",
      ossBucket: "hlovet-backups",
      ossPrefix: "database",
      ossAccessKeyId: "test-access-key",
      ossAccessKeySecret: "test-secret-key",
      r2Enabled: false,
      r2AccountId: "",
      r2Bucket: "",
      r2Prefix: "database",
    });

    expect(stored.ossAccessKeyIdEncrypted).not.toContain("test-access-key");
    expect(stored.ossAccessKeySecretEncrypted).not.toContain("test-secret-key");
    expect(crypto.decryptSecret(stored.ossAccessKeyIdEncrypted!)).toBe("test-access-key");
    expect(crypto.decryptSecret(stored.ossAccessKeySecretEncrypted!)).toBe("test-secret-key");
    expect(response).toMatchObject({
      automaticEnabled: true,
      localRetentionDays: 14,
      oss: { enabled: true, hasAccessKeyId: true, hasSecretAccessKey: true },
    });
  });

  it("rejects remote backup enablement without a server encryption key", async () => {
    const stored = configuration();
    const prisma = {
      backupConfiguration: { upsert: jest.fn(async () => stored) },
    } as unknown as PrismaService;
    const service = new BackupService(
      prisma,
      new BackupCryptoService(),
      {} as never,
      new BackupOperationLockService(),
    );

    await expect(service.updateConfiguration({
      automaticEnabled: false,
      scheduleTime: "03:00",
      localRetentionDays: 7,
      remoteRetentionDays: 90,
      ossEnabled: false,
      ossRegion: "",
      ossEndpoint: "",
      ossBucket: "",
      ossPrefix: "database",
      r2Enabled: true,
      r2AccountId: "account",
      r2Bucket: "bucket",
      r2Prefix: "database",
      r2AccessKeyId: "access",
      r2SecretAccessKey: "secret",
    })).rejects.toThrow("BACKUP_ENCRYPTION_KEY");
  });
});
