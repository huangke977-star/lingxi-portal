import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, opendir, rename, stat, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import type { BackupConfiguration } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BackupCryptoService } from "./backup-crypto.service";
import { BackupRemoteService } from "./backup-remote.service";
import { UpdateBackupConfigurationDto } from "./dto/backup.dto";
import type {
  BackupConfigurationResponse,
  BackupStatusResponse,
  DatabaseBackupResponse,
  RemoteBackupResult,
  RemoteProvider,
} from "./system-status.types";

type BackupEntry = DatabaseBackupResponse;

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDirectory = resolve(process.env.BACKUP_DIR ?? join(process.cwd(), "backups"));
  private activeBackupOperation: string | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private schedulerRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: BackupCryptoService,
    private readonly remote: BackupRemoteService,
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
        items.push({ name: basename(entry.name), sizeBytes: file.size, updatedAt: file.mtime.toISOString() });
      }
      items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return {
        available: true,
        totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
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
      return { success: true };
    });
  }

  async restoreBackup(
    rawName: string,
    confirmation: string,
  ): Promise<{ success: true; restored: string; safetyBackup: DatabaseBackupResponse }> {
    return this.withBackupLock("restore", async () => {
      const name = this.backupName(rawName);
      if (confirmation.trim() !== name) {
        throw new BadRequestException("请输入完整备份文件名确认恢复操作。");
      }
      const filePath = join(this.backupDirectory, name);
      await this.backupFileStat(filePath);
      const safetyBackup = await this.createBackupFile("pre-restore");
      await this.restoreBackupFile(filePath, name.endsWith(".gz"));
      return { success: true, restored: name, safetyBackup };
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
    await mkdir(this.backupDirectory, { recursive: true });
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
        pipeline(process.stdout, createGzip({ level: 6 }), createWriteStream(temporaryPath, { flags: "wx" })),
        this.waitForProcess(process, stderr, "数据库备份失败。"),
      ]);
      await rename(temporaryPath, filePath);
      const file = await stat(filePath);
      return { name, sizeBytes: file.size, updatedAt: file.mtime.toISOString() };
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
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
        if (file.mtimeMs < cutoff) await unlink(filePath);
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
  ): Promise<void> {
    return new Promise((resolveProcess, rejectProcess) => {
      child.once("error", () => rejectProcess(new BadRequestException(`${fallback} 数据库客户端不可用。`)));
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
    this.activeBackupOperation = operation;
    try {
      return await action();
    } finally {
      this.activeBackupOperation = null;
    }
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

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : "数据库备份失败。")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 500);
  }
}
