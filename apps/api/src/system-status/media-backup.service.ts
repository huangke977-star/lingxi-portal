import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  BackupConfiguration,
  MediaBackupFile,
  MediaBackupJobLogLevel,
  MediaBackupJobStatus,
  MediaBackupJobTrigger,
  MediaBackupManifestStatus,
  MediaBackupProvider,
  Prisma,
  StorageIssueKind,
  StorageRepairAction,
  StorageRepairStatus,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  MediaBackupFileQueryDto,
  MediaBackupJobQueryDto,
} from "./dto/media-backup.dto";
import { BackupCryptoService } from "./backup-crypto.service";
import {
  BackupOperationBusyException,
  BackupOperationLockService,
} from "./backup-operation-lock.service";
import { BackupRemoteService } from "./backup-remote.service";
import type { UploadedMediaRepairFile } from "./media-repair-upload.storage";
import type {
  MediaBackupFileListResponse,
  MediaBackupFileResponse,
  MediaBackupJobDetailResponse,
  MediaBackupJobListResponse,
  MediaBackupJobResponse,
  MediaBackupManifestResponse,
  StorageFileRepairResponse,
} from "./media-backup.types";
import type { StorageCategoryKey } from "./storage-management.types";
import type { RemoteProvider } from "./system-status.types";

const CATEGORY_DIRECTORIES = [
  {
    key: "backgrounds",
    env: "BACKGROUND_UPLOAD_DIR",
    fallback: ["uploads", "backgrounds"],
  },
  {
    key: "site-assets",
    env: "SITE_ASSET_UPLOAD_DIR",
    fallback: ["uploads", "site-assets"],
  },
  {
    key: "android-releases",
    env: "ANDROID_RELEASE_UPLOAD_DIR",
    fallback: ["uploads", "android-releases"],
  },
  {
    key: "avatars",
    env: "AVATAR_UPLOAD_DIR",
    fallback: ["uploads", "avatars"],
  },
  {
    key: "articles",
    env: "ARTICLE_UPLOAD_DIR",
    fallback: ["uploads", "articles"],
  },
  { key: "chat", env: "CHAT_UPLOAD_DIR", fallback: ["uploads", "chat"] },
] as const;
const HASH_STREAM_BYTES = 64 * 1024;
const MAX_UPLOAD_ATTEMPTS = 3;

type FileOutcome = "uploaded" | "reused" | "skipped" | "failed";

@Injectable()
export class MediaBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaBackupService.name);
  private readonly categoryDirectories = new Map<StorageCategoryKey, string>(
    CATEGORY_DIRECTORIES.map((category) => [
      category.key,
      resolve(
        process.env[category.env] ?? join(process.cwd(), ...category.fallback),
      ),
    ]),
  );
  private activeJobId: number | null = null;
  private activeJobPromise: Promise<void> | null = null;
  private startingJob = false;
  private schedulerRunning = false;
  private schedulerTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: BackupCryptoService,
    private readonly remote: BackupRemoteService,
    private readonly operationLock: BackupOperationLockService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.schedulerTimer = setInterval(() => void this.runScheduler(), 60_000);
    this.schedulerTimer.unref();
    setTimeout(() => void this.initializeScheduler(), 18_000).unref();
  }

  onModuleDestroy(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
  }

  async startBackup(
    triggeredById: number | null,
    trigger: MediaBackupJobTrigger = MediaBackupJobTrigger.manual,
  ): Promise<MediaBackupJobResponse> {
    if (this.startingJob || this.activeJobPromise) {
      throw new ConflictException(
        `媒体备份任务 #${this.activeJobId ?? "-"} 正在执行。`,
      );
    }
    const releaseOperationLock = this.operationLock.acquire(
      trigger === MediaBackupJobTrigger.scheduled
        ? "定时媒体备份"
        : "手动媒体备份",
    );
    this.startingJob = true;
    let jobOwnsOperationLock = false;
    try {
      const configuration = await this.ensureConfiguration();
      const providers = this.remote.enabledProviders(configuration);
      if (!providers.length) {
        throw new BadRequestException(
          "请先启用并配置阿里云 OSS 或 Cloudflare R2。",
        );
      }
      if (!this.crypto.isConfigured()) {
        throw new BadRequestException(
          "服务器尚未配置 BACKUP_ENCRYPTION_KEY，无法执行媒体备份。",
        );
      }
      const existing = await this.prisma.mediaBackupJob.findFirst({
        where: {
          status: {
            in: [MediaBackupJobStatus.pending, MediaBackupJobStatus.running],
          },
        },
        orderBy: { id: "desc" },
      });
      if (existing) {
        throw new ConflictException(`媒体备份任务 #${existing.id} 正在执行。`);
      }
      const job = await this.prisma.mediaBackupJob.create({
        data: {
          trigger,
          triggeredById,
          providers: providers as Prisma.InputJsonValue,
        },
      });
      this.activeJobId = job.id;
      this.activeJobPromise = this.performJob(job.id, configuration, providers)
        .catch((error) =>
          this.logger.error(
            `Media backup job ${job.id} failed`,
            error instanceof Error ? error.stack : undefined,
          ),
        )
        .finally(() => {
          this.activeJobId = null;
          this.activeJobPromise = null;
          releaseOperationLock();
        });
      jobOwnsOperationLock = true;
      return this.toJobResponse(job);
    } finally {
      this.startingJob = false;
      if (!jobOwnsOperationLock) releaseOperationLock();
    }
  }

  async listJobs(
    query: MediaBackupJobQueryDto,
  ): Promise<MediaBackupJobListResponse> {
    const where = query.status
      ? { status: query.status as MediaBackupJobStatus }
      : undefined;
    const [items, total] = await Promise.all([
      this.prisma.mediaBackupJob.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.mediaBackupJob.count({ where }),
    ]);
    return {
      items: items.map((item) => this.toJobResponse(item)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: total ? Math.ceil(total / query.pageSize) : 0,
    };
  }

  async getJob(id: number): Promise<MediaBackupJobDetailResponse> {
    const job = await this.prisma.mediaBackupJob.findUnique({
      where: { id },
      include: {
        manifests: {
          include: {
            file: {
              select: {
                category: true,
                storedName: true,
                sourceLabel: true,
              },
            },
          },
          orderBy: { id: "asc" },
        },
        logs: { orderBy: { id: "asc" } },
      },
    });
    if (!job) throw new NotFoundException("媒体备份任务不存在。");
    return {
      ...this.toJobResponse(job),
      manifests: job.manifests.map((item) => this.toManifestResponse(item)),
      logs: job.logs.map((item) => ({
        id: item.id,
        level: item.level,
        event: item.event,
        message: item.message,
        fileId: item.fileId,
        provider: item.provider,
        attempt: item.attempt,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  async listFiles(
    query: MediaBackupFileQueryDto,
  ): Promise<MediaBackupFileListResponse> {
    const q = query.q?.trim();
    const where: Prisma.MediaBackupFileWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      ...(q
        ? {
            OR: [
              { storedName: { contains: q } },
              { sourceLabel: { contains: q } },
              { uploadedBy: { contains: q } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.mediaBackupFile.findMany({
        where,
        orderBy: [{ category: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.mediaBackupFile.count({ where }),
    ]);
    return {
      items: items.map((item) => this.toFileResponse(item)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: total ? Math.ceil(total / query.pageSize) : 0,
    };
  }

  async restoreFile(
    fileId: number,
    confirmation: string,
    requestedProvider?: RemoteProvider,
  ): Promise<{
    success: true;
    file: MediaBackupFileResponse;
    provider: RemoteProvider;
    manifestId: number;
  }> {
    const file = await this.prisma.mediaBackupFile.findUnique({
      where: { id: fileId },
    });
    if (!file) throw new NotFoundException("媒体备份文件不存在。");
    if (confirmation.trim() !== file.storedName) {
      throw new BadRequestException("请输入完整存储文件名确认恢复操作。");
    }
    const configuration = await this.ensureConfiguration();
    const manifest = await this.findRestorableManifest(
      file.id,
      configuration,
      requestedProvider,
    );
    const restored = await this.restoreFromManifest(
      file,
      manifest,
      configuration,
    );
    return {
      success: true,
      file: this.toFileResponse(restored),
      provider: manifest.provider,
      manifestId: manifest.id,
    };
  }

  async restoreMissingIssue(
    issueId: number,
    actorId: number,
    requestedProvider?: RemoteProvider,
  ): Promise<StorageFileRepairResponse> {
    const issue = await this.openMissingIssue(issueId);
    const repair = await this.createRepair(
      issue,
      StorageRepairAction.remote_restore,
      actorId,
    );
    try {
      const file = await this.prisma.mediaBackupFile.findUnique({
        where: {
          category_storedName: {
            category: issue.category,
            storedName: issue.storedName,
          },
        },
      });
      if (!file) {
        throw new NotFoundException("该缺失文件没有可用的媒体备份目录记录。");
      }
      const configuration = await this.ensureConfiguration();
      const manifest = await this.findRestorableManifest(
        file.id,
        configuration,
        requestedProvider,
      );
      await this.prisma.storageFileRepair.update({
        where: { id: repair.id },
        data: {
          provider: manifest.provider,
          manifestId: manifest.id,
          expectedHash: manifest.contentHash,
        },
      });
      const restored = await this.restoreFromManifest(
        file,
        manifest,
        configuration,
      );
      const completed = await this.prisma.$transaction(async (transaction) => {
        await this.resolveMissingIssues(
          transaction,
          issue.category,
          issue.storedName,
          "remote_restored",
        );
        return transaction.storageFileRepair.update({
          where: { id: repair.id },
          data: {
            status: StorageRepairStatus.completed,
            provider: manifest.provider,
            manifestId: manifest.id,
            sizeBytes: restored.sizeBytes,
            expectedHash: manifest.contentHash,
            actualHash: restored.contentHash,
            completedAt: new Date(),
          },
        });
      });
      return this.toRepairResponse(completed);
    } catch (error) {
      await this.failRepair(repair.id, error);
      throw error;
    }
  }

  async reuploadMissingIssue(
    issueId: number,
    actorId: number,
    upload: UploadedMediaRepairFile | undefined,
  ): Promise<StorageFileRepairResponse> {
    if (!upload) throw new BadRequestException("请选择要重新上传的文件。");
    let stagedPath: string | null = null;
    let installed = false;
    const issue = await this.openMissingIssue(issueId).catch(async (error) => {
      await unlink(upload.path).catch(() => undefined);
      throw error;
    });
    const repair = await this.createRepair(
      issue,
      StorageRepairAction.reupload,
      actorId,
      {
        originalName: basename(upload.originalname).slice(0, 255),
        mimeType: upload.mimetype.slice(0, 127),
      },
    ).catch(async (error) => {
      await unlink(upload.path).catch(() => undefined);
      throw error;
    });
    const destinationPath = this.resolveCategoryFile(
      this.normalizeCategory(issue.category),
      issue.storedName,
    );
    try {
      if (await this.pathExists(destinationPath)) {
        throw new ConflictException("原位置已经存在文件，请重新扫描后再处理。");
      }
      const temporaryDirectory = join(dirname(destinationPath), ".tmp");
      await mkdir(temporaryDirectory, { recursive: true });
      stagedPath = join(temporaryDirectory, `${randomUUID()}.repair`);
      await this.moveFile(upload.path, stagedPath);
      const hashed = await this.hashFile(stagedPath);
      await rename(stagedPath, destinationPath);
      stagedPath = null;
      installed = true;
      const destination = await stat(destinationPath);
      const completed = await this.prisma.$transaction(async (transaction) => {
        await this.updateReferenceMetadata(
          transaction,
          issue,
          upload,
          hashed.contentHash,
          hashed.sizeBytes,
        );
        await transaction.mediaBackupFile.upsert({
          where: {
            category_storedName: {
              category: issue.category,
              storedName: issue.storedName,
            },
          },
          create: {
            category: issue.category,
            storedName: issue.storedName,
            mimeType: upload.mimetype.slice(0, 127),
            sourceType: issue.sourceType,
            sourceId: issue.sourceId,
            sourceLabel: issue.sourceLabel,
            sourceUrl: issue.sourceUrl,
            uploadedBy: issue.uploadedBy,
            sizeBytes: hashed.sizeBytes,
            contentHash: hashed.contentHash,
            fileUpdatedAt: destination.mtime,
            lastSeenAt: new Date(),
          },
          update: {
            mimeType: upload.mimetype.slice(0, 127),
            sizeBytes: hashed.sizeBytes,
            contentHash: hashed.contentHash,
            fileUpdatedAt: destination.mtime,
            lastSeenAt: new Date(),
            lastBackedUpAt: null,
          },
        });
        await this.resolveMissingIssues(
          transaction,
          issue.category,
          issue.storedName,
          "reuploaded",
        );
        return transaction.storageFileRepair.update({
          where: { id: repair.id },
          data: {
            status: StorageRepairStatus.completed,
            sizeBytes: hashed.sizeBytes,
            actualHash: hashed.contentHash,
            completedAt: new Date(),
          },
        });
      });
      return this.toRepairResponse(completed);
    } catch (error) {
      if (installed && (await this.pathExists(destinationPath))) {
        await unlink(destinationPath).catch(() => undefined);
      }
      await this.failRepair(repair.id, error);
      throw error;
    } finally {
      await unlink(upload.path).catch(() => undefined);
      if (stagedPath) await unlink(stagedPath).catch(() => undefined);
    }
  }

  async confirmMissingIssueUnrecoverable(
    issueId: number,
    actorId: number,
    note?: string,
  ): Promise<StorageFileRepairResponse> {
    const issue = await this.openMissingIssue(issueId);
    return this.prisma.$transaction(async (transaction) => {
      const repair = await transaction.storageFileRepair.create({
        data: {
          issueId: issue.id,
          category: issue.category,
          storedName: issue.storedName,
          sourceType: issue.sourceType,
          sourceId: issue.sourceId,
          action: StorageRepairAction.confirm_unrecoverable,
          status: StorageRepairStatus.completed,
          actorId,
          note: note?.trim().slice(0, 500) || null,
          completedAt: new Date(),
        },
      });
      await this.resolveMissingIssues(
        transaction,
        issue.category,
        issue.storedName,
        "confirmed_unrecoverable",
      );
      return this.toRepairResponse(repair);
    });
  }

  async listIssueRepairs(
    issueId: number,
  ): Promise<StorageFileRepairResponse[]> {
    const issue = await this.prisma.storageScanIssue.findUnique({
      where: { id: issueId },
      select: { category: true, storedName: true },
    });
    if (!issue) throw new NotFoundException("存储问题不存在。");
    const repairs = await this.prisma.storageFileRepair.findMany({
      where: { category: issue.category, storedName: issue.storedName },
      orderBy: { id: "desc" },
    });
    return repairs.map((item) => this.toRepairResponse(item));
  }

  private async initializeScheduler(): Promise<void> {
    const interrupted = await this.prisma.mediaBackupJob.findMany({
      where: {
        status: {
          in: [MediaBackupJobStatus.pending, MediaBackupJobStatus.running],
        },
      },
      select: { id: true },
    });
    if (interrupted.length) {
      const completedAt = new Date();
      await this.prisma.mediaBackupJob.updateMany({
        where: { id: { in: interrupted.map(({ id }) => id) } },
        data: {
          status: MediaBackupJobStatus.failed,
          error: "服务重启，未完成的媒体备份任务已终止。",
          completedAt,
        },
      });
      await this.prisma.mediaBackupJobLog.createMany({
        data: interrupted.map(({ id }) => ({
          jobId: id,
          level: MediaBackupJobLogLevel.error,
          event: "job.interrupted",
          message: "服务重启，未完成的媒体备份任务已终止。",
        })),
      });
    }
    await this.runScheduler();
  }

  private async runScheduler(): Promise<void> {
    if (this.schedulerRunning || this.activeJobPromise || this.startingJob)
      return;
    this.schedulerRunning = true;
    let scheduledDateKey: string | null = null;
    try {
      const configuration = await this.ensureConfiguration();
      if (!configuration.automaticEnabled) return;
      if (!this.remote.enabledProviders(configuration).length) return;
      if (!this.crypto.isConfigured()) return;
      const now = new Date();
      const dateKey = this.zonedDateKey(now, configuration.timezone);
      scheduledDateKey = dateKey;
      if (
        this.zonedTime(now, configuration.timezone) < configuration.scheduleTime
      )
        return;
      if (configuration.lastMediaBackupDate === dateKey) return;
      const claimed = await this.prisma.backupConfiguration.updateMany({
        where: {
          id: 1,
          automaticEnabled: true,
          OR: [
            { lastMediaBackupDate: null },
            { lastMediaBackupDate: { not: dateKey } },
          ],
        },
        data: { lastMediaBackupDate: dateKey },
      });
      if (!claimed.count) return;
      await this.startBackup(null, MediaBackupJobTrigger.scheduled);
    } catch (error) {
      if (error instanceof BackupOperationBusyException && scheduledDateKey) {
        await this.prisma.backupConfiguration.updateMany({
          where: { id: 1, lastMediaBackupDate: scheduledDateKey },
          data: { lastMediaBackupDate: null },
        });
        this.logger.log(
          "Scheduled media backup deferred because another backup operation is active.",
        );
        return;
      }
      if (!(error instanceof ConflictException))
        this.logger.warn(
          `Media backup scheduler failed: ${this.errorMessage(error)}`,
        );
    } finally {
      this.schedulerRunning = false;
    }
  }

  private async performJob(
    jobId: number,
    configuration: BackupConfiguration,
    providers: RemoteProvider[],
  ): Promise<void> {
    try {
      const latestScan = await this.prisma.storageScan.findFirst({
        where: { status: "completed" },
        orderBy: { id: "desc" },
        select: { startedAt: true },
      });
      if (!latestScan) {
        throw new BadRequestException("请先完成一次存储扫描，再执行媒体备份。");
      }
      const files = await this.prisma.mediaBackupFile.findMany({
        where: { lastSeenAt: { gte: latestScan.startedAt } },
        orderBy: [{ category: "asc" }, { id: "asc" }],
      });
      await this.prisma.mediaBackupJob.update({
        where: { id: jobId },
        data: {
          status: MediaBackupJobStatus.running,
          totalFiles: files.length,
          totalBytes: files.reduce(
            (total, file) => total + BigInt(file.sizeBytes),
            0n,
          ),
          startedAt: new Date(),
        },
      });
      await this.log(
        jobId,
        "info",
        "job.started",
        `开始顺序处理 ${files.length} 个媒体文件。`,
      );

      const counts = {
        processedFiles: 0,
        uploadedFiles: 0,
        reusedFiles: 0,
        skippedFiles: 0,
        failedFiles: 0,
        uploadedBytes: 0n,
      };
      for (const file of files) {
        let outcome: FileOutcome;
        try {
          outcome = await this.processFile(
            jobId,
            file,
            providers,
            configuration,
          );
        } catch (error) {
          outcome = "failed";
          await this.log(
            jobId,
            "error",
            "file.failed",
            `${file.storedName}：${this.errorMessage(error)}`,
            file.id,
          );
        }
        counts.processedFiles += 1;
        if (outcome === "uploaded") counts.uploadedFiles += 1;
        if (outcome === "reused") counts.reusedFiles += 1;
        if (outcome === "skipped") counts.skippedFiles += 1;
        if (outcome === "failed") counts.failedFiles += 1;
        const uploadedBytes = await this.prisma.mediaBackupManifest.aggregate({
          where: {
            jobId,
            fileId: file.id,
            status: MediaBackupManifestStatus.uploaded,
          },
          _sum: { sizeBytes: true },
        });
        counts.uploadedBytes += BigInt(uploadedBytes._sum.sizeBytes ?? 0);
        await this.prisma.mediaBackupJob.update({
          where: { id: jobId },
          data: counts,
        });
      }

      const status =
        counts.failedFiles === 0
          ? MediaBackupJobStatus.completed
          : counts.failedFiles === files.length
            ? MediaBackupJobStatus.failed
            : MediaBackupJobStatus.partial;
      const error = counts.failedFiles
        ? `${counts.failedFiles} 个文件备份失败，请查看任务日志。`
        : null;
      await this.prisma.mediaBackupJob.update({
        where: { id: jobId },
        data: { status, error, completedAt: new Date() },
      });
      await this.log(
        jobId,
        status === MediaBackupJobStatus.completed ? "info" : "warning",
        "job.completed",
        `媒体备份完成：上传 ${counts.uploadedFiles}，复用 ${counts.reusedFiles}，跳过 ${counts.skippedFiles}，失败 ${counts.failedFiles}。`,
      );
      await this.pruneExpiredJobs(jobId, configuration);
    } catch (error) {
      const message = this.errorMessage(error);
      await this.prisma.mediaBackupJob
        .update({
          where: { id: jobId },
          data: {
            status: MediaBackupJobStatus.failed,
            error: message,
            completedAt: new Date(),
          },
        })
        .catch(() => undefined);
      await this.log(jobId, "error", "job.failed", message).catch(
        () => undefined,
      );
      throw error;
    }
  }

  private async processFile(
    jobId: number,
    file: MediaBackupFile,
    providers: RemoteProvider[],
    configuration: BackupConfiguration,
  ): Promise<FileOutcome> {
    if (this.isExcludedFile(file)) {
      await this.log(
        jobId,
        "warning",
        "file.skipped",
        `${file.storedName} 位于临时、回收站或未完成上传区域，已跳过。`,
        file.id,
      );
      return "skipped";
    }
    const filePath = this.resolveCategoryFile(
      this.normalizeCategory(file.category),
      file.storedName,
    );
    const hashed = await this.hashCatalogFile(jobId, file, filePath);
    let uploaded = false;
    let failed = false;
    for (const provider of providers) {
      const bucket = this.remote.providerBucket(provider, configuration);
      const reusable = await this.prisma.mediaBackupManifest.findFirst({
        where: {
          provider: provider as MediaBackupProvider,
          contentHash: hashed.contentHash,
          sizeBytes: hashed.sizeBytes,
          bucket,
          objectKey: { not: null },
          status: {
            in: [
              MediaBackupManifestStatus.uploaded,
              MediaBackupManifestStatus.reused,
            ],
          },
        },
        orderBy: { id: "desc" },
      });
      const manifest = await this.prisma.mediaBackupManifest.create({
        data: {
          jobId,
          fileId: file.id,
          provider: provider as MediaBackupProvider,
          status: MediaBackupManifestStatus.pending,
          contentHash: hashed.contentHash,
          sizeBytes: hashed.sizeBytes,
          fileUpdatedAt: hashed.updatedAt,
          bucket,
          startedAt: new Date(),
        },
      });
      if (reusable?.objectKey) {
        await this.prisma.mediaBackupManifest.update({
          where: { id: manifest.id },
          data: {
            status: MediaBackupManifestStatus.reused,
            objectKey: reusable.objectKey,
            etag: reusable.etag,
            completedAt: new Date(),
          },
        });
        await this.log(
          jobId,
          "info",
          "file.reused",
          `${file.storedName} 在 ${provider.toUpperCase()} 复用已有对象。`,
          file.id,
          provider,
        );
        continue;
      }
      try {
        await this.uploadManifestWithRetry(
          jobId,
          manifest.id,
          file,
          filePath,
          hashed.contentHash,
          provider,
          configuration,
        );
        uploaded = true;
      } catch {
        failed = true;
      }
    }
    if (!failed) {
      await this.prisma.mediaBackupFile.update({
        where: { id: file.id },
        data: { lastBackedUpAt: new Date() },
      });
    }
    if (failed) return "failed";
    return uploaded ? "uploaded" : "reused";
  }

  private async uploadManifestWithRetry(
    jobId: number,
    manifestId: number,
    file: MediaBackupFile,
    filePath: string,
    contentHash: string,
    provider: RemoteProvider,
    configuration: BackupConfiguration,
  ): Promise<void> {
    let latestError: unknown;
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      await this.prisma.mediaBackupManifest.update({
        where: { id: manifestId },
        data: {
          attemptCount: attempt,
          lastAttemptAt: new Date(),
          error: null,
        },
      });
      try {
        const result = await this.remote.uploadMedia(
          filePath,
          contentHash,
          provider,
          configuration,
        );
        await this.prisma.mediaBackupManifest.update({
          where: { id: manifestId },
          data: {
            status: MediaBackupManifestStatus.uploaded,
            bucket: result.bucket,
            objectKey: result.objectKey,
            etag: result.etag,
            completedAt: new Date(),
          },
        });
        await this.log(
          jobId,
          "info",
          "file.uploaded",
          `${file.storedName} 已上传到 ${provider.toUpperCase()}。`,
          file.id,
          provider,
          attempt,
        );
        return;
      } catch (error) {
        latestError = error;
        const finalAttempt = attempt === MAX_UPLOAD_ATTEMPTS;
        await this.log(
          jobId,
          finalAttempt ? "error" : "warning",
          finalAttempt ? "upload.failed" : "upload.retry",
          `${file.storedName} 上传 ${provider.toUpperCase()} ${finalAttempt ? "失败" : "失败，将重试"}：${this.errorMessage(error)}`,
          file.id,
          provider,
          attempt,
        );
        if (!finalAttempt) await this.delay(this.retryDelayMs(attempt));
      }
    }
    await this.prisma.mediaBackupManifest.update({
      where: { id: manifestId },
      data: {
        status: MediaBackupManifestStatus.failed,
        error: this.errorMessage(latestError),
        completedAt: new Date(),
      },
    });
    throw latestError;
  }

  private async hashCatalogFile(
    jobId: number,
    file: MediaBackupFile,
    filePath: string,
  ): Promise<{ contentHash: string; sizeBytes: number; updatedAt: Date }> {
    const current = await this.fileStat(
      filePath,
      "媒体文件在计算哈希前已不存在。",
    );
    if (
      file.contentHash &&
      file.sizeBytes === current.size &&
      file.fileUpdatedAt?.getTime() === current.mtime.getTime()
    ) {
      await this.log(
        jobId,
        "info",
        "hash.reused",
        `${file.storedName} 的大小和修改时间未变化，复用已有哈希。`,
        file.id,
      );
      return {
        contentHash: file.contentHash,
        sizeBytes: current.size,
        updatedAt: current.mtime,
      };
    }
    const hashed = await this.hashFile(filePath, current);
    await this.prisma.mediaBackupFile.update({
      where: { id: file.id },
      data: {
        contentHash: hashed.contentHash,
        sizeBytes: hashed.sizeBytes,
        fileUpdatedAt: hashed.updatedAt,
      },
    });
    await this.log(
      jobId,
      "info",
      "hash.computed",
      `${file.storedName} 已完成顺序 SHA-256 计算。`,
      file.id,
    );
    return hashed;
  }

  private async hashFile(
    filePath: string,
    initialStat?: Awaited<ReturnType<typeof stat>>,
  ): Promise<{ contentHash: string; sizeBytes: number; updatedAt: Date }> {
    const before =
      initialStat ?? (await this.fileStat(filePath, "媒体文件不存在。"));
    const hash = createHash("sha256");
    const stream = createReadStream(filePath, {
      highWaterMark: HASH_STREAM_BYTES,
    });
    for await (const chunk of stream) hash.update(chunk as Buffer);
    const after = await this.fileStat(filePath, "媒体文件在计算哈希时被删除。");
    if (
      before.size !== after.size ||
      before.mtime.getTime() !== after.mtime.getTime()
    ) {
      throw new ConflictException("媒体文件在计算哈希时发生变化，请稍后重试。");
    }
    return {
      contentHash: hash.digest("hex"),
      sizeBytes: after.size,
      updatedAt: after.mtime,
    };
  }

  private async findRestorableManifest(
    fileId: number,
    configuration: BackupConfiguration,
    requestedProvider?: RemoteProvider,
  ) {
    const providers = requestedProvider
      ? [requestedProvider]
      : (["oss", "r2"] as RemoteProvider[]);
    for (const provider of providers) {
      let bucket: string;
      try {
        bucket = this.remote.providerBucket(provider, configuration);
      } catch {
        continue;
      }
      const manifest = await this.prisma.mediaBackupManifest.findFirst({
        where: {
          fileId,
          provider: provider as MediaBackupProvider,
          bucket,
          objectKey: { not: null },
          status: {
            in: [
              MediaBackupManifestStatus.uploaded,
              MediaBackupManifestStatus.reused,
            ],
          },
        },
        orderBy: { id: "desc" },
      });
      if (manifest?.objectKey) return manifest;
    }
    throw new NotFoundException(
      requestedProvider
        ? `该文件在 ${requestedProvider.toUpperCase()} 中没有可恢复的备份。`
        : "该文件没有可恢复的远端备份。",
    );
  }

  private async restoreFromManifest(
    file: MediaBackupFile,
    manifest: {
      id: number;
      provider: MediaBackupProvider;
      objectKey: string | null;
      contentHash: string;
      sizeBytes: number;
    },
    configuration: BackupConfiguration,
  ): Promise<MediaBackupFile> {
    if (!manifest.objectKey)
      throw new NotFoundException("远端备份对象不存在。");
    const destinationPath = this.resolveCategoryFile(
      this.normalizeCategory(file.category),
      file.storedName,
    );
    const temporaryDirectory = join(dirname(destinationPath), ".tmp");
    await mkdir(temporaryDirectory, { recursive: true });
    const token = randomUUID();
    const encryptedPath = join(temporaryDirectory, `${token}.restore.enc`);
    const restoredPath = join(temporaryDirectory, `${token}.restore`);
    try {
      await this.remote.downloadMedia(
        manifest.provider,
        manifest.objectKey,
        encryptedPath,
        configuration,
      );
      await this.crypto.decryptFile(encryptedPath, restoredPath);
      const hashed = await this.hashFile(restoredPath);
      if (
        hashed.sizeBytes !== manifest.sizeBytes ||
        hashed.contentHash !== manifest.contentHash
      ) {
        throw new BadRequestException(
          "恢复文件的大小或 SHA-256 校验失败，原文件未被替换。",
        );
      }
      await mkdir(dirname(destinationPath), { recursive: true });
      await this.atomicReplace(restoredPath, destinationPath);
      const destination = await stat(destinationPath);
      return this.prisma.mediaBackupFile.update({
        where: { id: file.id },
        data: {
          sizeBytes: hashed.sizeBytes,
          contentHash: hashed.contentHash,
          fileUpdatedAt: destination.mtime,
          lastSeenAt: new Date(),
          lastBackedUpAt: new Date(),
        },
      });
    } finally {
      await unlink(encryptedPath).catch(() => undefined);
      await unlink(restoredPath).catch(() => undefined);
    }
  }

  private async pruneExpiredJobs(
    currentJobId: number,
    configuration: BackupConfiguration,
  ): Promise<void> {
    const cutoff = new Date(
      Date.now() - configuration.remoteRetentionDays * 86_400_000,
    );
    const obsolete = await this.prisma.mediaBackupJob.findMany({
      where: {
        id: { not: currentJobId },
        status: { not: MediaBackupJobStatus.running },
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        manifests: {
          where: {
            objectKey: { not: null },
            status: {
              in: [
                MediaBackupManifestStatus.uploaded,
                MediaBackupManifestStatus.reused,
              ],
            },
          },
          select: { provider: true, bucket: true, objectKey: true },
        },
      },
      take: 100,
    });
    if (!obsolete.length) return;
    const obsoleteIds = obsolete.map(({ id }) => id);
    const objects = new Map<
      string,
      {
        provider: MediaBackupProvider;
        bucket: string;
        objectKey: string;
      }
    >();
    for (const job of obsolete) {
      for (const manifest of job.manifests) {
        if (!manifest.bucket || !manifest.objectKey) continue;
        objects.set(
          `${manifest.provider}\u0000${manifest.bucket}\u0000${manifest.objectKey}`,
          {
            provider: manifest.provider,
            bucket: manifest.bucket,
            objectKey: manifest.objectKey,
          },
        );
      }
    }
    for (const object of objects.values()) {
      const retained = await this.prisma.mediaBackupManifest.count({
        where: {
          jobId: { notIn: obsoleteIds },
          provider: object.provider,
          bucket: object.bucket,
          objectKey: object.objectKey,
          status: {
            in: [
              MediaBackupManifestStatus.uploaded,
              MediaBackupManifestStatus.reused,
            ],
          },
        },
      });
      if (retained) continue;
      try {
        if (
          this.remote.providerBucket(object.provider, configuration) !==
          object.bucket
        ) {
          throw new Error("当前配置的 Bucket 与历史清单不一致。");
        }
        await this.remote.deleteMediaObject(
          object.provider,
          object.objectKey,
          configuration,
        );
      } catch (error) {
        await this.log(
          currentJobId,
          "warning",
          "retention.deferred",
          `远端保留清理已延后：${this.errorMessage(error)}`,
          null,
          object.provider,
        );
        return;
      }
    }
    await this.prisma.mediaBackupJob.deleteMany({
      where: { id: { in: obsoleteIds } },
    });
    await this.log(
      currentJobId,
      "info",
      "retention.completed",
      `已清理 ${obsoleteIds.length} 个超过保留期限的媒体备份任务。`,
    );
  }

  private async updateReferenceMetadata(
    transaction: Prisma.TransactionClient,
    issue: {
      sourceType: string;
      sourceId: string | null;
    },
    upload: UploadedMediaRepairFile,
    contentHash: string,
    sizeBytes: number,
  ): Promise<void> {
    const id = Number(issue.sourceId);
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException("缺失文件的业务来源记录无效。");
    }
    const originalName = basename(upload.originalname).slice(0, 255);
    const mimeType = upload.mimetype.slice(0, 127);
    switch (issue.sourceType) {
      case "background":
        await transaction.backgroundImage.update({
          where: { id },
          data: { originalName, mimeType, sizeBytes },
        });
        return;
      case "android_release":
        await transaction.androidRelease.update({
          where: { id },
          data: { originalName, mimeType, sizeBytes, sha256: contentHash },
        });
        return;
      case "user_avatar":
        await transaction.user.update({
          where: { id },
          data: {
            avatarOriginalName: originalName,
            avatarMimeType: mimeType,
            avatarSizeBytes: sizeBytes,
          },
        });
        return;
      case "article_image":
        await transaction.articleImage.update({
          where: { id },
          data: { originalName, mimeType, sizeBytes },
        });
        return;
      case "chat_attachment":
        await transaction.chatAttachment.update({
          where: { id },
          data: { originalName, mimeType, sizeBytes },
        });
        return;
      default:
        if (issue.sourceType.startsWith("site_asset_")) {
          await transaction.siteAsset.update({
            where: { id },
            data: { originalName, mimeType, sizeBytes },
          });
          return;
        }
        throw new BadRequestException("该文件来源暂不支持重新上传修复。");
    }
  }

  private async resolveMissingIssues(
    transaction: Prisma.TransactionClient,
    category: string,
    storedName: string,
    resolution: string,
  ): Promise<void> {
    await transaction.storageScanIssue.updateMany({
      where: {
        category,
        storedName,
        kind: StorageIssueKind.missing,
        resolvedAt: null,
      },
      data: { resolvedAt: new Date(), resolution },
    });
  }

  private async openMissingIssue(id: number) {
    const issue = await this.prisma.storageScanIssue.findUnique({
      where: { id },
    });
    if (!issue || issue.resolvedAt || issue.kind !== StorageIssueKind.missing) {
      throw new NotFoundException("可处理的缺失文件记录不存在。");
    }
    this.normalizeCategory(issue.category);
    return issue;
  }

  private async createRepair(
    issue: Awaited<ReturnType<MediaBackupService["openMissingIssue"]>>,
    action: StorageRepairAction,
    actorId: number,
    extra: { originalName?: string; mimeType?: string } = {},
  ) {
    return this.prisma.storageFileRepair.create({
      data: {
        issueId: issue.id,
        category: issue.category,
        storedName: issue.storedName,
        sourceType: issue.sourceType,
        sourceId: issue.sourceId,
        action,
        actorId,
        originalName: extra.originalName,
        mimeType: extra.mimeType,
      },
    });
  }

  private async failRepair(id: number, error: unknown): Promise<void> {
    await this.prisma.storageFileRepair
      .update({
        where: { id },
        data: {
          status: StorageRepairStatus.failed,
          error: this.errorMessage(error),
          completedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  private async log(
    jobId: number,
    level: "info" | "warning" | "error",
    event: string,
    message: string,
    fileId: number | null = null,
    provider: RemoteProvider | null = null,
    attempt: number | null = null,
  ): Promise<void> {
    await this.prisma.mediaBackupJobLog.create({
      data: {
        jobId,
        level: level as MediaBackupJobLogLevel,
        event: event.slice(0, 64),
        message: message.replace(/[\r\n]+/g, " ").slice(0, 500),
        fileId,
        provider: provider as MediaBackupProvider | null,
        attempt,
      },
    });
  }

  private async ensureConfiguration(): Promise<BackupConfiguration> {
    return this.prisma.backupConfiguration.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  private isExcludedFile(file: MediaBackupFile): boolean {
    const segments = file.storedName.replace(/\\/g, "/").split("/");
    return (
      segments.some((segment) => segment === ".tmp" || segment === ".trash") ||
      file.storedName.endsWith(".tmp") ||
      file.sourceType === "temporary_upload" ||
      (file.sourceType === "chat_attachment" &&
        file.sourceLabel.includes("待发送"))
    );
  }

  private resolveCategoryFile(
    category: StorageCategoryKey,
    storedName: string,
  ): string {
    const root = this.categoryDirectories.get(category);
    if (!root) throw new BadRequestException("存储分类无效。");
    const normalized = storedName.replace(/\\/g, "/").replace(/^\/+/, "");
    if (
      !normalized ||
      normalized
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    ) {
      throw new BadRequestException("存储文件路径无效。");
    }
    const filePath = resolve(root, ...normalized.split("/"));
    if (!filePath.startsWith(`${root}${sep}`)) {
      throw new BadRequestException("存储文件路径无效。");
    }
    return filePath;
  }

  private normalizeCategory(category: string): StorageCategoryKey {
    if (!this.categoryDirectories.has(category as StorageCategoryKey)) {
      throw new BadRequestException("存储分类无效。");
    }
    return category as StorageCategoryKey;
  }

  private async atomicReplace(
    source: string,
    destination: string,
  ): Promise<void> {
    try {
      await rename(source, destination);
    } catch (error) {
      const code =
        error instanceof Error && "code" in error ? error.code : null;
      if (code !== "EEXIST" && code !== "EPERM") throw error;
      const previous = `${source}.previous`;
      await rename(destination, previous);
      try {
        await rename(source, destination);
        await unlink(previous).catch(() => undefined);
      } catch (replacementError) {
        await rename(previous, destination).catch(() => undefined);
        throw replacementError;
      }
    }
  }

  private async moveFile(source: string, destination: string): Promise<void> {
    try {
      await rename(source, destination);
    } catch (error) {
      const code =
        error instanceof Error && "code" in error ? error.code : null;
      if (code !== "EXDEV") throw error;
      await copyFile(source, destination);
      await unlink(source);
    }
  }

  private async fileStat(filePath: string, message: string) {
    try {
      const file = await stat(filePath);
      if (!file.isFile()) throw new Error("Not a file");
      return file;
    } catch {
      throw new NotFoundException(message);
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private retryDelayMs(attempt: number): number {
    const configured = Number(process.env.MEDIA_BACKUP_RETRY_DELAY_MS);
    const base =
      Number.isFinite(configured) && configured >= 0 ? configured : 5_000;
    return Math.min(base * 2 ** Math.max(0, attempt - 1), 30_000);
  }

  private delay(milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise((resolveDelay) =>
      setTimeout(resolveDelay, milliseconds),
    );
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

  private toJobResponse(job: {
    id: number;
    status: MediaBackupJobStatus;
    trigger: MediaBackupJobTrigger;
    triggeredById: number | null;
    providers: Prisma.JsonValue;
    totalFiles: number;
    processedFiles: number;
    uploadedFiles: number;
    reusedFiles: number;
    skippedFiles: number;
    failedFiles: number;
    totalBytes: bigint;
    uploadedBytes: bigint;
    error: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
  }): MediaBackupJobResponse {
    const providers = Array.isArray(job.providers)
      ? job.providers.filter(
          (item): item is RemoteProvider => item === "oss" || item === "r2",
        )
      : [];
    return {
      id: job.id,
      status: job.status,
      trigger: job.trigger,
      triggeredById: job.triggeredById,
      providers,
      totalFiles: job.totalFiles,
      processedFiles: job.processedFiles,
      uploadedFiles: job.uploadedFiles,
      reusedFiles: job.reusedFiles,
      skippedFiles: job.skippedFiles,
      failedFiles: job.failedFiles,
      totalBytes: Number(job.totalBytes),
      uploadedBytes: Number(job.uploadedBytes),
      error: job.error,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
    };
  }

  private toManifestResponse(manifest: {
    id: number;
    fileId: number;
    provider: MediaBackupProvider;
    status: MediaBackupManifestStatus;
    contentHash: string;
    sizeBytes: number;
    bucket: string | null;
    objectKey: string | null;
    etag: string | null;
    error: string | null;
    attemptCount: number;
    lastAttemptAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    file: { category: string; storedName: string; sourceLabel: string };
  }): MediaBackupManifestResponse {
    return {
      id: manifest.id,
      fileId: manifest.fileId,
      category: this.normalizeCategory(manifest.file.category),
      storedName: manifest.file.storedName,
      sourceLabel: manifest.file.sourceLabel,
      provider: manifest.provider,
      status: manifest.status,
      contentHash: manifest.contentHash,
      sizeBytes: manifest.sizeBytes,
      bucket: manifest.bucket,
      objectKey: manifest.objectKey,
      etag: manifest.etag,
      error: manifest.error,
      attemptCount: manifest.attemptCount,
      lastAttemptAt: manifest.lastAttemptAt?.toISOString() ?? null,
      startedAt: manifest.startedAt?.toISOString() ?? null,
      completedAt: manifest.completedAt?.toISOString() ?? null,
    };
  }

  private toFileResponse(file: MediaBackupFile): MediaBackupFileResponse {
    return {
      id: file.id,
      category: this.normalizeCategory(file.category),
      storedName: file.storedName,
      sourceType: file.sourceType,
      sourceId: file.sourceId,
      sourceLabel: file.sourceLabel,
      sizeBytes: file.sizeBytes,
      contentHash: file.contentHash,
      fileUpdatedAt: file.fileUpdatedAt?.toISOString() ?? null,
      lastSeenAt: file.lastSeenAt.toISOString(),
      lastBackedUpAt: file.lastBackedUpAt?.toISOString() ?? null,
    };
  }

  private toRepairResponse(repair: {
    id: number;
    issueId: number | null;
    category: string;
    storedName: string;
    action: StorageRepairAction;
    status: StorageRepairStatus;
    provider: MediaBackupProvider | null;
    manifestId: number | null;
    actorId: number | null;
    originalName: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    expectedHash: string | null;
    actualHash: string | null;
    note: string | null;
    error: string | null;
    startedAt: Date;
    completedAt: Date | null;
  }): StorageFileRepairResponse {
    return {
      id: repair.id,
      issueId: repair.issueId,
      category: this.normalizeCategory(repair.category),
      storedName: repair.storedName,
      action: repair.action,
      status: repair.status,
      provider: repair.provider,
      manifestId: repair.manifestId,
      actorId: repair.actorId,
      originalName: repair.originalName,
      mimeType: repair.mimeType,
      sizeBytes: repair.sizeBytes,
      expectedHash: repair.expectedHash,
      actualHash: repair.actualHash,
      note: repair.note,
      error: repair.error,
      startedAt: repair.startedAt.toISOString(),
      completedAt: repair.completedAt?.toISOString() ?? null,
    };
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : "媒体备份操作失败。")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 500);
  }
}
