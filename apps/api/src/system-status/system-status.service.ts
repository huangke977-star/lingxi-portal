import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, opendir, rename, stat, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { DatabaseBackupResponse, SystemStatusResponse } from "./system-status.types";

interface DirectoryUsage {
  available: boolean;
  sizeBytes: number;
  fileCount: number;
}

type BackupEntry = DatabaseBackupResponse;

interface DatabaseVersionRow {
  version: string;
}

interface DatabaseSizeRow {
  sizeBytes: unknown;
}

interface MigrationCountRow {
  migrationCount: unknown;
}

interface MigrationRow {
  migrationName: string;
  finishedAt: Date | string | null;
}

const STORAGE_DIRECTORIES = [
  { key: "backgrounds", label: "背景图片", env: "BACKGROUND_UPLOAD_DIR", fallback: ["uploads", "backgrounds"] },
  { key: "site-assets", label: "站点资源", env: "SITE_ASSET_UPLOAD_DIR", fallback: ["uploads", "site-assets"] },
  { key: "android-releases", label: "Android 安装包", env: "ANDROID_RELEASE_UPLOAD_DIR", fallback: ["uploads", "android-releases"] },
  { key: "avatars", label: "用户头像", env: "AVATAR_UPLOAD_DIR", fallback: ["uploads", "avatars"] },
  { key: "articles", label: "文章媒体", env: "ARTICLE_UPLOAD_DIR", fallback: ["uploads", "articles"] },
  { key: "chat", label: "聊天附件", env: "CHAT_UPLOAD_DIR", fallback: ["uploads", "chat"] },
] as const;

@Injectable()
export class SystemStatusService {
  private readonly backupDirectory = resolve(
    process.env.BACKUP_DIR ?? join(process.cwd(), "backups"),
  );
  private activeBackupOperation: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getStatus(): Promise<SystemStatusResponse> {
    const memory = process.memoryUsage();
    const [database, redis, storageItems, backups] = await Promise.all([
      this.databaseStatus(),
      this.redisStatus(),
      Promise.all(STORAGE_DIRECTORIES.map(async (item) => ({
        key: item.key,
        label: item.label,
        ...await this.directoryUsage(resolve(
          process.env[item.env] ?? join(process.cwd(), ...item.fallback),
        )),
      }))),
      this.backupStatus(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      application: {
        status: "ok",
        service: "lingxi-api",
        nodeVersion: process.version,
        environment: process.env.NODE_ENV ?? "development",
        uptimeSeconds: Math.floor(process.uptime()),
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
          externalBytes: memory.external,
        },
      },
      database,
      redis,
      storage: {
        totalBytes: storageItems.reduce((total, item) => total + item.sizeBytes, 0),
        totalFiles: storageItems.reduce((total, item) => total + item.fileCount, 0),
        items: storageItems,
      },
      backups,
      containerRuntime: {
        connected: false,
        message: "为避免授予 Web API 宿主机控制权限，容器状态请在 1Panel 或 SSH 中查看。",
      },
    };
  }

  async createBackup(): Promise<DatabaseBackupResponse> {
    return this.withBackupLock("create", () => this.createBackupFile("manual"));
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

  private async databaseStatus(): Promise<SystemStatusResponse["database"]> {
    const startedAt = performance.now();
    try {
      const [versionRows, sizeRows, migrationCountRows, migrationRows] = await Promise.all([
        this.prisma.$queryRawUnsafe<DatabaseVersionRow[]>("SELECT VERSION() AS version"),
        this.prisma.$queryRawUnsafe<DatabaseSizeRow[]>(
          "SELECT COALESCE(SUM(data_length + index_length), 0) AS sizeBytes FROM information_schema.tables WHERE table_schema = DATABASE()",
        ),
        this.prisma.$queryRawUnsafe<MigrationCountRow[]>(
          "SELECT COUNT(*) AS migrationCount FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
        ),
        this.prisma.$queryRawUnsafe<MigrationRow[]>(
          "SELECT migration_name AS migrationName, finished_at AS finishedAt FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1",
        ),
      ]);
      const latestMigration = migrationRows[0];
      return {
        connected: true,
        latencyMs: this.elapsedMilliseconds(startedAt),
        version: versionRows[0]?.version ?? null,
        sizeBytes: this.numericValue(sizeRows[0]?.sizeBytes),
        migrationCount: this.numericValue(migrationCountRows[0]?.migrationCount),
        latestMigration: latestMigration ? {
          name: latestMigration.migrationName,
          finishedAt: latestMigration.finishedAt
            ? new Date(latestMigration.finishedAt).toISOString()
            : null,
        } : null,
        error: null,
      };
    } catch {
      return {
        connected: false,
        latencyMs: this.elapsedMilliseconds(startedAt),
        version: null,
        sizeBytes: null,
        migrationCount: null,
        latestMigration: null,
        error: "MySQL 状态读取失败。",
      };
    }
  }

  private async redisStatus(): Promise<SystemStatusResponse["redis"]> {
    const startedAt = performance.now();
    try {
      const [pong, info, keyCount] = await Promise.all([
        this.redis.ping(),
        this.redis.info(),
        this.redis.dbsize(),
      ]);
      if (pong !== "PONG") {
        throw new Error("Unexpected Redis ping response.");
      }
      const values = this.parseRedisInfo(info);
      return {
        connected: true,
        latencyMs: this.elapsedMilliseconds(startedAt),
        version: values.get("redis_version") ?? null,
        keyCount,
        usedMemoryBytes: this.numericValue(values.get("used_memory")),
        maxMemoryBytes: this.numericValue(values.get("maxmemory")),
        connectedClients: this.numericValue(values.get("connected_clients")),
        error: null,
      };
    } catch {
      return {
        connected: false,
        latencyMs: this.elapsedMilliseconds(startedAt),
        version: null,
        keyCount: null,
        usedMemoryBytes: null,
        maxMemoryBytes: null,
        connectedClients: null,
        error: "Redis 状态读取失败。",
      };
    }
  }

  private async backupStatus(): Promise<SystemStatusResponse["backups"]> {
    try {
      const directory = await opendir(this.backupDirectory);
      const items: BackupEntry[] = [];
      for await (const entry of directory) {
        if (!entry.isFile() || !/\.sql(?:\.gz)?$/i.test(entry.name)) {
          continue;
        }
        const file = await stat(join(this.backupDirectory, entry.name));
        items.push({
          name: basename(entry.name),
          sizeBytes: file.size,
          updatedAt: file.mtime.toISOString(),
        });
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
      return {
        available: false,
        totalBytes: 0,
        fileCount: 0,
        latest: null,
        items: [],
      };
    }
  }

  private async directoryUsage(directoryPath: string): Promise<DirectoryUsage> {
    try {
      const directory = await opendir(directoryPath);
      let sizeBytes = 0;
      let fileCount = 0;
      for await (const entry of directory) {
        const entryPath = join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          const nested = await this.directoryUsage(entryPath);
          sizeBytes += nested.sizeBytes;
          fileCount += nested.fileCount;
        } else if (entry.isFile()) {
          const file = await stat(entryPath);
          sizeBytes += file.size;
          fileCount += 1;
        }
      }
      return { available: true, sizeBytes, fileCount };
    } catch {
      return { available: false, sizeBytes: 0, fileCount: 0 };
    }
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
        compressed
          ? pipeline(input, createGunzip(), process.stdin)
          : pipeline(input, process.stdin),
        this.waitForProcess(process, stderr, "数据库恢复失败。"),
      ]);
    } catch (error) {
      process.kill("SIGTERM");
      throw error;
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

  private parseRedisInfo(info: string): Map<string, string> {
    const values = new Map<string, string>();
    for (const line of info.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf(":");
      if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
    }
    return values;
  }

  private numericValue(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private elapsedMilliseconds(startedAt: number): number {
    return Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10);
  }
}
