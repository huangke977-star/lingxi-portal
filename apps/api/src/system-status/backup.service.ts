import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, opendir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import type { BackupConfiguration } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BackupCryptoService } from "./backup-crypto.service";
import {
  BackupOperationBusyException,
  BackupOperationLockService,
} from "./backup-operation-lock.service";
import { BackupRemoteService } from "./backup-remote.service";
import { UpdateBackupConfigurationDto } from "./dto/backup.dto";
import { StorageManagementService } from "./storage-management.service";
import type {
  BackupConfigurationResponse,
  BackupRestorePreflightResponse,
  BackupStatusResponse,
  BackupVerificationResponse,
  DatabaseBackupResponse,
  RemoteBackupResult,
  RemoteProvider,
} from "./system-status.types";

type BackupEntry = DatabaseBackupResponse;

type BackupVerificationRecord = BackupVerificationResponse & {
  version: 1;
};

const MEDIA_SNAPSHOT_DIRECTORIES = [
  "backgrounds",
  "site-assets",
  "android-releases",
  "avatars",
  "articles",
  "chat",
] as const;

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDirectory = resolve(process.env.BACKUP_DIR ?? join(process.cwd(), "backups"));
  private readonly mediaDirectory = resolve(process.cwd(), "uploads");
  private activeBackupOperation: string | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private schedulerRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: BackupCryptoService,
    private readonly remote: BackupRemoteService,
    private readonly operationLock: BackupOperationLockService,
    @Optional() private readonly storageManagement?: StorageManagementService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.schedulerTimer = setInterval(() => void this.runScheduler(), 60_000);
    this.schedulerTimer.unref();
    setTimeout(() => void this.runScheduler(), 8_000).unref();
  }

  onModuleDestroy(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
  }

  async getStatus(): Promise<BackupStatusResponse> {
    try {
      const directory = await opendir(this.backupDirectory);
      const items: BackupEntry[] = [];
      for await (const entry of directory) {
        if (!entry.isFile() || !/\.sql(?:\.gz)?$/i.test(entry.name)) continue;
        const file = await stat(join(this.backupDirectory, entry.name));
        const name = basename(entry.name);
        items.push(await this.toBackupResponse(name, file));
      }
      items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return {
        available: true,
        totalBytes: items.reduce((total, item) => total + item.sizeBytes + (item.mediaSnapshotSizeBytes ?? 0), 0),
        fileCount: items.length,
        latest: items[0] ?? null,
        items,
      };
    } catch {
      return { available: false, totalBytes: 0, fileCount: 0, latest: null, items: [] };
    }
  }

  async getConfiguration(): Promise<BackupConfigurationResponse> {
    return this.toConfigurationResponse(await this.ensureConfiguration());
  }

  async updateConfiguration(dto: UpdateBackupConfigurationDto): Promise<BackupConfigurationResponse> {
    const current = await this.ensureConfiguration();
    if ((dto.ossEnabled || dto.r2Enabled) && !this.crypto.isConfigured()) {
      throw new BadRequestException("服务器尚未配置 BACKUP_ENCRYPTION_KEY，无法启用异地备份。");
    }
    const ossAccessKeyIdEncrypted = this.nextCredential(
      current.ossAccessKeyIdEncrypted,
      dto.ossAccessKeyId,
      dto.clearOssCredentials,
    );
    const ossAccessKeySecretEncrypted = this.nextCredential(
      current.ossAccessKeySecretEncrypted,
      dto.ossAccessKeySecret,
      dto.clearOssCredentials,
    );
    const r2AccessKeyIdEncrypted = this.nextCredential(
      current.r2AccessKeyIdEncrypted,
      dto.r2AccessKeyId,
      dto.clearR2Credentials,
    );
    const r2SecretAccessKeyEncrypted = this.nextCredential(
      current.r2SecretAccessKeyEncrypted,
      dto.r2SecretAccessKey,
      dto.clearR2Credentials,
    );
    const ossRegion = dto.ossRegion.trim();
    const ossEndpoint = dto.ossEndpoint.trim();
    const ossBucket = dto.ossBucket.trim();
    const r2AccountId = dto.r2AccountId.trim();
    const r2Bucket = dto.r2Bucket.trim();
    if (ossEndpoint) this.assertHttpsUrl(ossEndpoint, "OSS Endpoint");
    if (dto.ossEnabled && (!ossRegion || !ossBucket || !ossAccessKeyIdEncrypted || !ossAccessKeySecretEncrypted)) {
      throw new BadRequestException("启用阿里云 OSS 前，请完整填写 Region、Bucket 和访问凭证。");
    }
    if (dto.r2Enabled && (!r2AccountId || !r2Bucket || !r2AccessKeyIdEncrypted || !r2SecretAccessKeyEncrypted)) {
      throw new BadRequestException("启用 Cloudflare R2 前，请完整填写 Account ID、Bucket 和访问凭证。");
    }
    const configuration = await this.prisma.backupConfiguration.update({
      where: { id: 1 },
      data: {
        automaticEnabled: dto.automaticEnabled,
        scheduleTime: dto.scheduleTime,
        localRetentionDays: dto.localRetentionDays,
        remoteRetentionDays: dto.remoteRetentionDays,
        ossEnabled: dto.ossEnabled,
        ossRegion: ossRegion || null,
        ossEndpoint: ossEndpoint || null,
        ossBucket: ossBucket || null,
        ossPrefix: this.normalizePrefix(dto.ossPrefix),
        ossAccessKeyIdEncrypted,
        ossAccessKeySecretEncrypted,
        r2Enabled: dto.r2Enabled,
        r2AccountId: r2AccountId || null,
        r2Bucket: r2Bucket || null,
        r2Prefix: this.normalizePrefix(dto.r2Prefix),
        r2AccessKeyIdEncrypted,
        r2SecretAccessKeyEncrypted,
      },
    });
    return this.toConfigurationResponse(configuration);
  }

  async testProvider(provider: RemoteProvider): Promise<{ success: true; provider: RemoteProvider }> {
    return this.remote.test(provider, await this.ensureConfiguration());
  }

  async createBackup(): Promise<DatabaseBackupResponse> {
    return this.withBackupLock("manual", () => this.performBackup("manual", true));
  }

  async getBackupDownload(rawName: string): Promise<{
    name: string;
    filePath: string;
    sizeBytes: number;
    mimeType: string;
  }> {
    const name = this.backupName(rawName);
    const filePath = join(this.backupDirectory, name);
    const file = await this.backupFileStat(filePath);
    return {
      name,
      filePath,
      sizeBytes: file.size,
      mimeType: name.endsWith(".gz") ? "application/gzip" : "application/sql",
    };
  }

  async deleteBackup(rawName: string): Promise<{ success: true }> {
    return this.withBackupLock("delete", async () => {
      const name = this.backupName(rawName);
      const filePath = join(this.backupDirectory, name);
      await this.backupFileStat(filePath);
      await unlink(filePath);
      await unlink(this.mediaSnapshotPath(name)).catch(() => undefined);
      await unlink(this.verificationPath(name)).catch(() => undefined);
      return { success: true };
    });
  }

  async verifyBackup(rawName: string): Promise<DatabaseBackupResponse> {
    return this.withBackupLock("verify", async () => {
      const name = this.backupName(rawName);
      const file = await this.backupFileStat(join(this.backupDirectory, name));
      await this.verifyAndPersistBackup(name);
      return this.toBackupResponse(name, file);
    });
  }

  async getRestorePreflight(rawName: string): Promise<BackupRestorePreflightResponse> {
    return this.withBackupLock("preflight", async () => {
      const name = this.backupName(rawName);
      const file = await this.backupFileStat(join(this.backupDirectory, name));
      const verification = await this.verifyAndPersistBackup(name);
      return this.toRestorePreflight(await this.toBackupResponse(name, file, verification));
    });
  }

  async restoreBackup(
    rawName: string,
    confirmation: string,
  ): Promise<{
    success: true;
    restored: string;
    safetyBackup: DatabaseBackupResponse;
    warning: string | null;
    storageScanId: number | null;
  }> {
    return this.withBackupLock("restore", async () => {
      const name = this.backupName(rawName);
      if (confirmation.trim() !== name) {
        throw new BadRequestException("请输入完整备份文件名确认恢复操作。");
      }
      const filePath = join(this.backupDirectory, name);
      const file = await this.backupFileStat(filePath);
      const preflight = this.toRestorePreflight(await this.toBackupResponse(
        name,
        file,
        await this.verifyAndPersistBackup(name),
      ));
      if (!preflight.canRestore) {
        throw new BadRequestException(`备份校验未通过，无法恢复：${preflight.warnings.join("；")}`);
      }
      const safetyBackup = await this.createBackupFile("pre-restore");
      await this.restoreBackupFile(filePath, name.endsWith(".gz"));
      const mediaSnapshotRestored = await this.restoreMediaSnapshot(name);
      // A backup can predate the running API. Bring its schema forward before
      // reporting success so restored data cannot leave newer API queries unusable.
      await this.deployPendingMigrations();
      let storageScanId: number | null = null;
      let storageScanWarning: string | null = null;
      if (this.storageManagement) {
        try {
          storageScanId = (await this.storageManagement.startScan(null)).id;
        } catch (error) {
          storageScanWarning = `恢复后的附件扫描未启动：${this.errorMessage(error)}`;
        }
      }
      const warning = [
        mediaSnapshotRestored
          ? null
          : "该备份仅包含数据库，未找到对应媒体快照。当前上传文件已保留，但此前已被物理删除的历史附件无法恢复。",
        storageScanWarning,
      ].filter((item): item is string => Boolean(item)).join("；") || null;
      return {
        success: true,
        restored: name,
        safetyBackup,
        warning,
        storageScanId,
      };
    });
  }

  private async runScheduler(): Promise<void> {
    if (this.schedulerRunning || this.activeBackupOperation) return;
    this.schedulerRunning = true;
    try {
      const configuration = await this.ensureConfiguration();
      if (!configuration.automaticEnabled) return;
      const now = new Date();
      const dateKey = this.zonedDateKey(now, configuration.timezone);
      if (this.zonedTime(now, configuration.timezone) < configuration.scheduleTime) return;
      if (configuration.lastAutomaticBackupDate === dateKey) return;
      const claimed = await this.prisma.backupConfiguration.updateMany({
        where: {
          id: 1,
          automaticEnabled: true,
          OR: [
            { lastAutomaticBackupDate: null },
            { lastAutomaticBackupDate: { not: dateKey } },
          ],
        },
        data: { lastAutomaticBackupDate: dateKey },
      });
      if (!claimed.count) return;
      try {
        const result = await this.withBackupLock("automatic", () => this.performBackup("automatic", true));
        if (result.warning) await this.notifyBackupFailure(result.warning);
      } catch (error) {
        if (error instanceof BackupOperationBusyException) {
          await this.prisma.backupConfiguration.updateMany({
            where: { id: 1, lastAutomaticBackupDate: dateKey },
            data: { lastAutomaticBackupDate: null },
          });
          this.logger.log("Automatic database backup deferred because another backup operation is active.");
          return;
        }
        const message = this.errorMessage(error);
        await this.recordFailure(message);
        await this.notifyBackupFailure(message);
        this.logger.error(`Automatic database backup failed: ${message}`);
      }
    } catch (error) {
      this.logger.error(`Backup scheduler failed: ${this.errorMessage(error)}`);
    } finally {
      this.schedulerRunning = false;
    }
  }

  private async performBackup(prefix: string, uploadRemote: boolean): Promise<DatabaseBackupResponse> {
    const configuration = await this.ensureConfiguration();
    let backup: DatabaseBackupResponse;
    try {
      backup = await this.createBackupFile(prefix);
    } catch (error) {
      await this.recordFailure(this.errorMessage(error));
      throw error;
    }
    let remoteResults: RemoteBackupResult[] = [];
    if (uploadRemote) {
      try {
        remoteResults = await this.remote.upload(
          join(this.backupDirectory, backup.name),
          backup.name,
          configuration,
        );
      } catch (error) {
        remoteResults = ([
          ...(configuration.ossEnabled ? ["oss" as const] : []),
          ...(configuration.r2Enabled ? ["r2" as const] : []),
        ]).map((provider) => ({
          provider,
          status: "failed" as const,
          objectKey: null,
          error: this.errorMessage(error),
        }));
      }
    }
    await this.cleanupLocal(configuration.localRetentionDays, backup.name);
    const failed = remoteResults.filter((result) => result.status === "failed");
    const warning = failed.length
      ? `本地备份已完成，但${failed.map((result) => result.provider === "oss" ? "阿里云 OSS" : "Cloudflare R2").join("、")}上传失败：${failed.map((result) => result.error).filter(Boolean).join("；")}`.slice(0, 500)
      : null;
    await this.prisma.backupConfiguration.update({
      where: { id: 1 },
      data: {
        lastSuccessAt: new Date(),
        lastBackupName: backup.name,
        ...(warning ? { lastFailureAt: new Date(), lastFailureMessage: warning } : { lastFailureMessage: null }),
      },
    });
    return { ...backup, remoteResults, warning };
  }

  private async createBackupFile(prefix: string): Promise<DatabaseBackupResponse> {
    await mkdir(this.backupDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.backupDirectory, 0o700);
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").replace(/\..+$/, "");
    const name = `${prefix}-${timestamp}.sql.gz`;
    const filePath = join(this.backupDirectory, name);
    const temporaryPath = `${filePath}.tmp`;
    const process = spawn("mariadb-dump", this.dumpArguments(), {
      env: this.databaseProcessEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr = this.collectProcessError(process.stderr);
    try {
      await Promise.all([
        pipeline(
          process.stdout,
          createGzip({ level: 6 }),
          createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
        ),
        this.waitForProcess(process, stderr, "数据库备份失败。"),
      ]);
      await rename(temporaryPath, filePath);
      await this.createMediaSnapshot(name);
      const verification = await this.verifyAndPersistBackup(name, true);
      if (verification.status === "failed") {
        throw new BadRequestException(`备份归档校验失败：${verification.error ?? "无法读取备份文件。"}`);
      }
      return this.toBackupResponse(name, await stat(filePath), verification);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      await unlink(filePath).catch(() => undefined);
      await unlink(this.mediaSnapshotPath(name)).catch(() => undefined);
      await unlink(this.verificationPath(name)).catch(() => undefined);
      throw error;
    }
  }

  /** Keeps SQL and upload files paired so a restored database still has its referenced media. */
  private async createMediaSnapshot(backupName: string) {
    await mkdir(this.mediaDirectory, { recursive: true, mode: 0o700 });
    await Promise.all(MEDIA_SNAPSHOT_DIRECTORIES.map((directory) => mkdir(join(this.mediaDirectory, directory), {
      recursive: true,
      mode: 0o700,
    })));
    const snapshotPath = this.mediaSnapshotPath(backupName);
    const temporaryPath = `${snapshotPath}.tmp`;
    const process = spawn("tar", [
      "-C",
      this.mediaDirectory,
      "-czf",
      temporaryPath,
      ...MEDIA_SNAPSHOT_DIRECTORIES,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    const stderr = this.collectProcessError(process.stderr);
    try {
      await this.waitForProcess(process, stderr, "媒体快照创建失败。", "媒体归档工具不可用。");
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, snapshotPath);
      return await stat(snapshotPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  /** Extracts additively so recovering an old database cannot delete newer uploaded files. */
  private async restoreMediaSnapshot(backupName: string): Promise<boolean> {
    const snapshotPath = this.mediaSnapshotPath(backupName);
    if (!(await this.mediaSnapshotStat(backupName))) return false;
    await mkdir(this.mediaDirectory, { recursive: true, mode: 0o700 });
    const process = spawn("tar", ["-C", this.mediaDirectory, "-xzf", snapshotPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr = this.collectProcessError(process.stderr);
    await this.waitForProcess(process, stderr, "媒体快照恢复失败。", "媒体归档工具不可用。");
    return true;
  }

  private async restoreBackupFile(filePath: string, compressed: boolean): Promise<void> {
    const process = spawn("mariadb", this.restoreArguments(), {
      env: this.databaseProcessEnvironment(),
      stdio: ["pipe", "ignore", "pipe"],
    });
    const stderr = this.collectProcessError(process.stderr);
    const input = createReadStream(filePath);
    try {
      await Promise.all([
        compressed ? pipeline(input, createGunzip(), process.stdin) : pipeline(input, process.stdin),
        this.waitForProcess(process, stderr, "数据库恢复失败。"),
      ]);
    } catch (error) {
      process.kill("SIGTERM");
      throw error;
    }
  }

  private async cleanupLocal(retentionDays: number, currentName: string): Promise<void> {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    try {
      const directory = await opendir(this.backupDirectory);
      for await (const entry of directory) {
        if (!entry.isFile() || entry.name === currentName || !/\.sql(?:\.gz)?$/i.test(entry.name)) continue;
        const filePath = join(this.backupDirectory, entry.name);
        const file = await stat(filePath);
        if (file.mtimeMs < cutoff) {
          await unlink(filePath);
          await unlink(this.mediaSnapshotPath(entry.name)).catch(() => undefined);
          await unlink(this.verificationPath(entry.name)).catch(() => undefined);
        }
      }
    } catch (error) {
      this.logger.warn(`Local backup cleanup failed: ${this.errorMessage(error)}`);
    }
  }

  private async notifyBackupFailure(message: string): Promise<void> {
    const administrators = await this.prisma.user.findMany({
      where: { isSuperAdmin: true, status: "active" },
      select: { id: true },
    });
    if (!administrators.length) return;
    await this.prisma.userNotification.createMany({
      data: administrators.map((administrator) => ({
        userId: administrator.id,
        type: "system" as const,
        channel: "system" as const,
        title: "数据库自动备份异常",
        body: message.slice(0, 500),
        actionUrl: "/admin/system",
      })),
    });
  }

  private async recordFailure(message: string): Promise<void> {
    await this.prisma.backupConfiguration.update({
      where: { id: 1 },
      data: { lastFailureAt: new Date(), lastFailureMessage: message.slice(0, 500) },
    }).catch(() => undefined);
  }

  private async ensureConfiguration(): Promise<BackupConfiguration> {
    return this.prisma.backupConfiguration.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  private toConfigurationResponse(configuration: BackupConfiguration): BackupConfigurationResponse {
    return {
      automaticEnabled: configuration.automaticEnabled,
      scheduleTime: configuration.scheduleTime,
      timezone: configuration.timezone,
      localRetentionDays: configuration.localRetentionDays,
      remoteRetentionDays: configuration.remoteRetentionDays,
      encryptionConfigured: this.crypto.isConfigured(),
      nextRunAt: this.nextRunAt(configuration),
      lastAutomaticBackupDate: configuration.lastAutomaticBackupDate,
      lastMediaBackupDate: configuration.lastMediaBackupDate,
      lastSuccessAt: configuration.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: configuration.lastFailureAt?.toISOString() ?? null,
      lastFailureMessage: configuration.lastFailureMessage,
      lastBackupName: configuration.lastBackupName,
      oss: {
        enabled: configuration.ossEnabled,
        region: configuration.ossRegion ?? "",
        endpoint: configuration.ossEndpoint ?? "",
        bucket: configuration.ossBucket ?? "",
        prefix: configuration.ossPrefix,
        hasAccessKeyId: Boolean(configuration.ossAccessKeyIdEncrypted),
        hasSecretAccessKey: Boolean(configuration.ossAccessKeySecretEncrypted),
      },
      r2: {
        enabled: configuration.r2Enabled,
        accountId: configuration.r2AccountId ?? "",
        bucket: configuration.r2Bucket ?? "",
        prefix: configuration.r2Prefix,
        hasAccessKeyId: Boolean(configuration.r2AccessKeyIdEncrypted),
        hasSecretAccessKey: Boolean(configuration.r2SecretAccessKeyEncrypted),
      },
    };
  }

  private nextRunAt(configuration: BackupConfiguration): string | null {
    if (!configuration.automaticEnabled) return null;
    const now = new Date();
    const dateKey = this.zonedDateKey(now, configuration.timezone);
    const offset = configuration.timezone === "Asia/Shanghai" ? "+08:00" : "Z";
    let candidate = new Date(`${dateKey}T${configuration.scheduleTime}:00${offset}`);
    if (candidate <= now || configuration.lastAutomaticBackupDate === dateKey) {
      candidate = new Date(candidate.getTime() + 86_400_000);
    }
    return candidate.toISOString();
  }

  private zonedDateKey(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  private zonedTime(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).format(date);
  }

  private nextCredential(current: string | null, value?: string, clear?: boolean): string | null {
    if (clear) return null;
    const normalized = value?.trim();
    return normalized ? this.crypto.encryptSecret(normalized) : current;
  }

  private normalizePrefix(value: string): string {
    return value.trim().replace(/^\/+|\/+$/g, "").slice(0, 255) || "database";
  }

  private assertHttpsUrl(value: string, label: string): void {
    try {
      if (new URL(value).protocol !== "https:") throw new Error("Invalid protocol");
    } catch {
      throw new BadRequestException(`${label} 必须是有效的 HTTPS 地址。`);
    }
  }

  private dumpArguments(): string[] {
    const database = process.env.MYSQL_DATABASE?.trim();
    if (!database) throw new BadRequestException("MYSQL_DATABASE 未配置。");
    return [
      `--host=${process.env.MYSQL_HOST?.trim() || "mysql"}`,
      `--port=${process.env.MYSQL_PORT?.trim() || "3306"}`,
      `--user=${process.env.MYSQL_USER?.trim() || "lingxi"}`,
      "--single-transaction",
      "--quick",
      "--skip-lock-tables",
      "--no-tablespaces",
      "--default-character-set=utf8mb4",
      database,
    ];
  }

  private restoreArguments(): string[] {
    const database = process.env.MYSQL_DATABASE?.trim();
    if (!database) throw new BadRequestException("MYSQL_DATABASE 未配置。");
    return [
      `--host=${process.env.MYSQL_HOST?.trim() || "mysql"}`,
      `--port=${process.env.MYSQL_PORT?.trim() || "3306"}`,
      `--user=${process.env.MYSQL_USER?.trim() || "lingxi"}`,
      "--binary-mode",
      "--default-character-set=utf8mb4",
      database,
    ];
  }

  private databaseProcessEnvironment(): NodeJS.ProcessEnv {
    return { ...process.env, MYSQL_PWD: process.env.MYSQL_PASSWORD ?? "" };
  }

  private collectProcessError(stream: NodeJS.ReadableStream): { value: string } {
    const result = { value: "" };
    stream.on("data", (chunk) => {
      if (result.value.length < 4000) result.value += String(chunk).slice(0, 4000 - result.value.length);
    });
    return result;
  }

  private waitForProcess(
    child: ReturnType<typeof spawn>,
    stderr: { value: string },
    fallback: string,
    unavailableMessage = "数据库客户端不可用。",
  ): Promise<void> {
    return new Promise((resolveProcess, rejectProcess) => {
      child.once("error", () => rejectProcess(new BadRequestException(`${fallback} ${unavailableMessage}`)));
      child.once("close", (code) => {
        if (code === 0) resolveProcess();
        else rejectProcess(new BadRequestException(stderr.value.trim() || fallback));
      });
    });
  }

  private async withBackupLock<T>(operation: string, action: () => Promise<T>): Promise<T> {
    if (this.activeBackupOperation) {
      throw new ConflictException(`数据库备份任务正在执行：${this.activeBackupOperation}`);
    }
    const releaseOperationLock = this.operationLock.acquire(`数据库${this.operationLabel(operation)}`);
    this.activeBackupOperation = operation;
    try {
      return await action();
    } finally {
      this.activeBackupOperation = null;
      releaseOperationLock();
    }
  }

  private async deployPendingMigrations(): Promise<void> {
    try {
      await this.runPrismaMigrationCommand(["migrate", "deploy"], "数据库恢复后迁移失败。");
    } catch (error) {
      if (!this.isRecoverableChatGroupBanMigrationError(error) || !(await this.hasChatGroupBanSchema())) {
        throw error;
      }
      this.logger.warn("Recovered the completed chat group ban migration left pending by a restored backup.");
      await this.runPrismaMigrationCommand(
        ["migrate", "resolve", "--applied", "20260813113000_add_chat_group_bans"],
        "数据库恢复后迁移记录修复失败。",
      );
      await this.runPrismaMigrationCommand(["migrate", "deploy"], "数据库恢复后迁移失败。");
    }
  }

  private async hasChatGroupBanSchema(): Promise<boolean> {
    try {
      await Promise.all([
        this.prisma.chatGroup.findFirst({
          select: { id: true, isBanned: true, bannedUntil: true, banReason: true },
        }),
        this.prisma.chatGroupBanRecord.findFirst({ select: { id: true } }),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  private isRecoverableChatGroupBanMigrationError(error: unknown): boolean {
    const message = this.errorMessage(error);
    return message.includes("P3018")
      && message.includes("20260813113000_add_chat_group_bans")
      && message.includes("chat_group_ban_records");
  }

  private async runPrismaMigrationCommand(arguments_: string[], fallback: string): Promise<void> {
    const apiDirectory = join(process.cwd(), "apps", "api");
    const prismaBinary = join(
      apiDirectory,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "prisma.cmd" : "prisma",
    );
    const child = spawn(prismaBinary, arguments_, {
      cwd: apiDirectory,
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr = this.collectProcessError(child.stderr);
    await this.waitForProcess(child, stderr, fallback);
  }

  private operationLabel(operation: string): string {
    const labels: Record<string, string> = {
      automatic: "定时备份",
      manual: "手动备份",
      delete: "备份删除",
      restore: "备份恢复",
    };
    return labels[operation] ?? "备份任务";
  }

  private backupName(rawName: string): string {
    const name = basename(rawName.trim());
    if (name !== rawName.trim() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.sql(?:\.gz)?$/.test(name)) {
      throw new BadRequestException("备份文件名无效。");
    }
    return name;
  }

  private async backupFileStat(filePath: string) {
    try {
      const file = await stat(filePath);
      if (!file.isFile()) throw new Error("Not a file");
      return file;
    } catch {
      throw new NotFoundException("备份文件不存在。");
    }
  }

  private async toBackupResponse(
    name: string,
    file: { size: number; mtime: Date },
    verification?: BackupVerificationResponse,
  ): Promise<DatabaseBackupResponse> {
    const mediaSnapshot = await this.mediaSnapshotStat(name);
    return {
      name,
      sizeBytes: file.size,
      mediaSnapshotAvailable: Boolean(mediaSnapshot),
      mediaSnapshotSizeBytes: mediaSnapshot?.size ?? null,
      verification: verification ?? await this.readVerification(name, Boolean(mediaSnapshot)),
      updatedAt: file.mtime.toISOString(),
    };
  }

  private toRestorePreflight(backup: DatabaseBackupResponse): BackupRestorePreflightResponse {
    const warnings: string[] = [];
    if (!backup.verification.databaseValid) {
      warnings.push(backup.verification.error || "数据库备份归档无法完整读取。");
    }
    if (backup.mediaSnapshotAvailable && !backup.verification.mediaValid) {
      warnings.push(backup.verification.error || "媒体快照归档无法完整读取。");
    }
    if (!backup.mediaSnapshotAvailable) {
      warnings.push("这是仅数据库的旧备份。恢复后会保留当前上传文件，但无法找回此前已物理删除的历史附件。");
    } else if (backup.verification.mediaDirectories.length !== MEDIA_SNAPSHOT_DIRECTORIES.length) {
      warnings.push("媒体快照未覆盖全部六个上传目录，恢复前请先重新校验或使用其他备份。");
    }
    return {
      backup,
      canRestore: backup.verification.databaseValid === true
        && (!backup.mediaSnapshotAvailable || backup.verification.mediaValid === true)
        && (backup.verification.mediaDirectories.length === 0
          || backup.verification.mediaDirectories.length === MEDIA_SNAPSHOT_DIRECTORIES.length),
      warnings,
    };
  }

  private async verifyAndPersistBackup(
    name: string,
    requireMediaSnapshot = false,
  ): Promise<BackupVerificationResponse> {
    const current = await this.readVerificationRecord(name);
    const verification = await this.validateBackup(
      name,
      requireMediaSnapshot || current?.mediaValid === true,
    );
    await this.writeVerification(name, verification);
    return verification;
  }

  /** Reads every compressed byte so a successful result means the archive is structurally readable. */
  private async validateBackup(
    name: string,
    requireMediaSnapshot: boolean,
  ): Promise<BackupVerificationResponse> {
    let databaseValid = false;
    let mediaValid: boolean | null = null;
    let mediaFileCount: number | null = null;
    let mediaDirectories: string[] = [];
    let error: string | null = null;
    try {
      await this.validateDatabaseArchive(name);
      databaseValid = true;
    } catch (validationError) {
      error = `数据库归档校验失败：${this.errorMessage(validationError)}`;
    }

    const mediaSnapshot = await this.mediaSnapshotStat(name);
    if (mediaSnapshot) {
      try {
        const archive = await this.inspectMediaArchive(name);
        mediaFileCount = archive.fileCount;
        mediaDirectories = archive.directories;
        mediaValid = archive.directories.length === MEDIA_SNAPSHOT_DIRECTORIES.length;
        if (!mediaValid) {
          error = error || "媒体快照未覆盖全部六个上传目录。";
        }
      } catch (validationError) {
        mediaValid = false;
        error = error || `媒体归档校验失败：${this.errorMessage(validationError)}`;
      }
    } else if (requireMediaSnapshot) {
      mediaValid = false;
      error = error || "媒体快照文件已缺失。";
    }

    const status = !databaseValid || mediaValid === false
      ? "failed"
      : mediaSnapshot
        ? "verified"
        : "database_only";
    return {
      status,
      verifiedAt: new Date().toISOString(),
      databaseValid,
      mediaValid,
      mediaFileCount,
      mediaDirectories,
      error,
    };
  }

  private async validateDatabaseArchive(name: string): Promise<void> {
    const source = createReadStream(join(this.backupDirectory, name));
    const discard = () => new Writable({
      write(_chunk, _encoding, callback) { callback(); },
    });
    if (name.endsWith(".gz")) {
      await pipeline(source, createGunzip(), discard());
      return;
    }
    await pipeline(source, discard());
  }

  private async inspectMediaArchive(name: string): Promise<{ fileCount: number; directories: string[] }> {
    const snapshotPath = this.mediaSnapshotPath(name);
    const process = spawn("tar", ["-tzf", snapshotPath], { stdio: ["ignore", "pipe", "pipe"] });
    const stderr = this.collectProcessError(process.stderr);
    let buffered = "";
    let fileCount = 0;
    const directories = new Set<string>();
    const inspectLine = (line: string) => {
      const path = line.trim().replace(/^\.\//, "");
      if (!path) return;
      const root = path.split("/", 1)[0];
      if ((MEDIA_SNAPSHOT_DIRECTORIES as readonly string[]).includes(root)) directories.add(root);
      if (!path.endsWith("/")) fileCount += 1;
    };
    const outputDone = new Promise<void>((resolveOutput, rejectOutput) => {
      process.stdout.setEncoding("utf8");
      process.stdout.on("data", (chunk: string) => {
        buffered += chunk;
        let newline = buffered.indexOf("\n");
        while (newline >= 0) {
          inspectLine(buffered.slice(0, newline));
          buffered = buffered.slice(newline + 1);
          newline = buffered.indexOf("\n");
        }
      });
      process.stdout.once("end", () => {
        inspectLine(buffered);
        resolveOutput();
      });
      process.stdout.once("error", rejectOutput);
    });
    await Promise.all([
      outputDone,
      this.waitForProcess(process, stderr, "媒体归档校验失败。", "媒体归档工具不可用。"),
    ]);
    return {
      fileCount,
      directories: MEDIA_SNAPSHOT_DIRECTORIES.filter((directory) => directories.has(directory)),
    };
  }

  private async readVerification(name: string, mediaSnapshotAvailable: boolean): Promise<BackupVerificationResponse> {
    const record = await this.readVerificationRecord(name);
    if (!record) {
      return {
        status: "not_verified",
        verifiedAt: null,
        databaseValid: null,
        mediaValid: null,
        mediaFileCount: null,
        mediaDirectories: [],
        error: null,
      };
    }
    if (record.mediaValid === true && !mediaSnapshotAvailable) {
      return {
        ...record,
        status: "failed",
        mediaValid: false,
        error: "媒体快照文件已缺失，请勿恢复此备份。",
      };
    }
    return record;
  }

  private async readVerificationRecord(name: string): Promise<BackupVerificationRecord | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.verificationPath(name), "utf8"));
      if (!this.isVerificationRecord(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private isVerificationRecord(value: unknown): value is BackupVerificationRecord {
    if (!value || typeof value !== "object") return false;
    const record = value as Partial<BackupVerificationRecord>;
    return record.version === 1
      && (record.status === "verified" || record.status === "database_only" || record.status === "failed")
      && typeof record.verifiedAt === "string"
      && typeof record.databaseValid === "boolean"
      && (typeof record.mediaValid === "boolean" || record.mediaValid === null)
      && (typeof record.mediaFileCount === "number" || record.mediaFileCount === null)
      && Array.isArray(record.mediaDirectories)
      && (typeof record.error === "string" || record.error === null);
  }

  private async writeVerification(name: string, verification: BackupVerificationResponse): Promise<void> {
    const filePath = this.verificationPath(name);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const record: BackupVerificationRecord = { version: 1, ...verification };
    try {
      await writeFile(temporaryPath, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, filePath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  private mediaSnapshotPath(backupName: string): string {
    return join(this.backupDirectory, `${backupName}.media.tar.gz`);
  }

  private verificationPath(backupName: string): string {
    return join(this.backupDirectory, `${backupName}.verification.json`);
  }

  private async mediaSnapshotStat(backupName: string) {
    try {
      const file = await stat(this.mediaSnapshotPath(backupName));
      return file.isFile() ? file : null;
    } catch {
      return null;
    }
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : "数据库备份失败。")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 500);
  }
}
