import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  opendir,
  rename,
  stat,
  statfs,
  unlink,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  Prisma,
  StorageIssueKind,
  StorageRepairAction,
  StorageRepairStatus,
  StorageScanStatus,
  StorageScanTrigger,
  UserNotificationChannel,
  UserNotificationType,
  UserStatus,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  StorageIssueQueryDto,
  StorageTrashQueryDto,
  UpdateStorageManagementConfigurationDto,
} from "./dto/storage-management.dto";
import { MediaBackupCatalogService } from "./media-backup-catalog.service";
import type { MediaBackupCatalogFile } from "./media-backup-catalog.types";
import type {
  StorageCategoryKey,
  StorageCategorySummary,
  StorageIssueListResponse,
  StorageIssueResponse,
  StorageManagementConfigurationResponse,
  StorageOverviewResponse,
  StorageScanResponse,
  StorageScanSummary,
  StorageTrashItemResponse,
  StorageTrashListResponse,
} from "./storage-management.types";

interface StorageCategoryDefinition {
  key: StorageCategoryKey;
  label: string;
  directory: string;
}

interface StorageReference {
  category: StorageCategoryKey;
  storedName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sourceType: string;
  sourceId: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  uploadedBy: string | null;
}

interface ScannedFile {
  relativeName: string;
  fullPath: string;
  sizeBytes: number;
  updatedAt: Date;
}

const CATEGORY_DEFINITIONS = [
  { key: "backgrounds", label: "背景图片", env: "BACKGROUND_UPLOAD_DIR", fallback: ["uploads", "backgrounds"] },
  { key: "site-assets", label: "站点资源", env: "SITE_ASSET_UPLOAD_DIR", fallback: ["uploads", "site-assets"] },
  { key: "android-releases", label: "Android 安装包", env: "ANDROID_RELEASE_UPLOAD_DIR", fallback: ["uploads", "android-releases"] },
  { key: "avatars", label: "用户头像", env: "AVATAR_UPLOAD_DIR", fallback: ["uploads", "avatars"] },
  { key: "articles", label: "文章媒体", env: "ARTICLE_UPLOAD_DIR", fallback: ["uploads", "articles"] },
  { key: "chat", label: "聊天附件", env: "CHAT_UPLOAD_DIR", fallback: ["uploads", "chat"] },
] as const;

const TEMPORARY_FILE_PROTECTION_MS = 24 * 60 * 60 * 1000;
const MAX_SCANNED_FILES = 50_000;
const RETAINED_SCAN_COUNT = 10;

@Injectable()
export class StorageManagementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageManagementService.name);
  private readonly categories: StorageCategoryDefinition[] = CATEGORY_DEFINITIONS.map((category) => ({
    key: category.key,
    label: category.label,
    directory: resolve(process.env[category.env] ?? join(process.cwd(), ...category.fallback)),
  }));
  private activeScanId: number | null = null;
  private activeScanPromise: Promise<void> | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private schedulerRunning = false;
  private lastPurgeCheckAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaBackupCatalog: MediaBackupCatalogService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.schedulerTimer = setInterval(() => void this.runScheduler(), 60_000);
    this.schedulerTimer.unref();
    setTimeout(() => void this.initializeScheduler(), 12_000).unref();
  }

  onModuleDestroy(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
  }

  async getOverview(): Promise<StorageOverviewResponse> {
    const [configuration, latestScan, missing, orphan, metadataMismatch, trash, expiredCount] = await Promise.all([
      this.ensureConfiguration(),
      this.prisma.storageScan.findFirst({ orderBy: { id: "desc" } }),
      this.countLatestIssues(StorageIssueKind.missing),
      this.countLatestIssues(StorageIssueKind.orphan),
      this.countLatestIssues(StorageIssueKind.metadata_mismatch),
      this.prisma.storageTrashItem.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
      this.prisma.storageTrashItem.count({ where: { purgeAfter: { lte: new Date() } } }),
    ]);

    return {
      configuration: this.toConfigurationResponse(configuration),
      latestScan: latestScan ? this.toScanResponse(latestScan) : null,
      openIssues: {
        missing,
        orphan,
        metadataMismatch,
        total: missing + orphan + metadataMismatch,
      },
      trash: {
        count: trash._count._all,
        sizeBytes: trash._sum.sizeBytes ?? 0,
        expiredCount,
      },
    };
  }

  async getStatusStorageSummary(): Promise<{
    totalBytes: number;
    totalFiles: number;
    items: Array<{
      key: string;
      label: string;
      available: boolean;
      sizeBytes: number;
      fileCount: number;
    }>;
  }> {
    const scan = await this.prisma.storageScan.findFirst({
      where: { status: StorageScanStatus.completed },
      orderBy: { id: "desc" },
      select: { summary: true },
    });
    const summary = scan?.summary as unknown as StorageScanSummary | null;
    if (!summary?.categories) {
      return {
        totalBytes: 0,
        totalFiles: 0,
        items: this.categories.map((category) => ({
          key: category.key,
          label: category.label,
          available: false,
          sizeBytes: 0,
          fileCount: 0,
        })),
      };
    }
    return {
      totalBytes: summary.totalBytes,
      totalFiles: summary.totalFiles,
      items: summary.categories.map((category) => ({
        key: category.key,
        label: category.label,
        available: category.available,
        sizeBytes: category.sizeBytes,
        fileCount: category.fileCount,
      })),
    };
  }

  async startScan(
    triggeredById: number | null,
    trigger: StorageScanTrigger = StorageScanTrigger.manual,
  ): Promise<StorageScanResponse> {
    if (this.activeScanPromise) {
      throw new ConflictException(`存储扫描任务 #${this.activeScanId ?? "-"} 正在执行。`);
    }
    const existing = await this.prisma.storageScan.findFirst({
      where: { status: StorageScanStatus.running },
      orderBy: { id: "desc" },
    });
    if (existing) {
      throw new ConflictException(`存储扫描任务 #${existing.id} 正在执行。`);
    }

    const scan = await this.prisma.storageScan.create({
      data: { trigger, triggeredById, status: StorageScanStatus.running },
    });
    this.activeScanId = scan.id;
    this.activeScanPromise = this.performScan(scan.id)
      .catch((error) => this.logger.error(`Storage scan ${scan.id} failed`, error instanceof Error ? error.stack : undefined))
      .finally(() => {
        this.activeScanId = null;
        this.activeScanPromise = null;
      });
    return this.toScanResponse(scan);
  }

  async getScan(id: number): Promise<StorageScanResponse> {
    const scan = await this.prisma.storageScan.findUnique({ where: { id } });
    if (!scan) throw new NotFoundException("存储扫描任务不存在。");
    return this.toScanResponse(scan);
  }

  async listIssues(query: StorageIssueQueryDto): Promise<StorageIssueListResponse> {
    const scan = await this.prisma.storageScan.findFirst({
      where: { status: StorageScanStatus.completed },
      orderBy: { id: "desc" },
    });
    if (!scan) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize, pageCount: 0, scan: null };
    }
    const q = query.q?.trim();
    const where: Prisma.StorageScanIssueWhereInput = {
      scanId: scan.id,
      resolvedAt: null,
      ...(query.kind ? { kind: query.kind as StorageIssueKind } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(q ? {
        OR: [
          { storedName: { contains: q } },
          { sourceLabel: { contains: q } },
          { uploadedBy: { contains: q } },
        ],
      } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.storageScanIssue.findMany({
        where,
        orderBy: [{ kind: "asc" }, { category: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.storageScanIssue.count({ where }),
    ]);
    return {
      items: items.map((item) => this.toIssueResponse(item)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: total ? Math.ceil(total / query.pageSize) : 0,
      scan: this.toScanResponse(scan),
    };
  }

  async getConfiguration(): Promise<StorageManagementConfigurationResponse> {
    return this.toConfigurationResponse(await this.ensureConfiguration());
  }

  async updateConfiguration(
    dto: UpdateStorageManagementConfigurationDto,
  ): Promise<StorageManagementConfigurationResponse> {
    const configuration = await this.prisma.storageManagementConfiguration.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        automaticScanEnabled: dto.automaticScanEnabled,
        scanTime: dto.scanTime,
        trashRetentionDays: dto.trashRetentionDays,
        warningThresholdPercent: dto.warningThresholdPercent,
      },
      update: {
        automaticScanEnabled: dto.automaticScanEnabled,
        scanTime: dto.scanTime,
        trashRetentionDays: dto.trashRetentionDays,
        warningThresholdPercent: dto.warningThresholdPercent,
      },
    });
    return this.toConfigurationResponse(configuration);
  }

  async listTrash(query: StorageTrashQueryDto): Promise<StorageTrashListResponse> {
    const where = query.category ? { category: query.category } : undefined;
    const [items, total] = await Promise.all([
      this.prisma.storageTrashItem.findMany({
        where,
        orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.storageTrashItem.count({ where }),
    ]);
    return {
      items: items.map((item) => this.toTrashResponse(item)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: total ? Math.ceil(total / query.pageSize) : 0,
    };
  }

  async getIssueFile(id: number): Promise<{
    filePath: string;
    mimeType: string;
    sizeBytes: number;
    name: string;
  }> {
    const issue = await this.openOrphanIssue(id);
    if (await this.isReferenced(issue.category as StorageCategoryKey, issue.storedName)) {
      throw new ConflictException("该文件已重新被业务数据引用，不能按孤立文件读取。");
    }
    const filePath = this.resolveCategoryFile(issue.category as StorageCategoryKey, issue.storedName);
    const file = await this.fileStat(filePath, "孤立文件不存在，可能已经被清理。");
    return {
      filePath,
      mimeType: this.mimeTypeForName(issue.storedName),
      sizeBytes: file.size,
      name: basename(issue.storedName),
    };
  }

  async trashIssue(id: number, actorId: number): Promise<StorageTrashItemResponse> {
    const issue = await this.openOrphanIssue(id);
    const category = issue.category as StorageCategoryKey;
    if (await this.isReferenced(category, issue.storedName)) {
      throw new ConflictException("该文件已重新被业务数据引用，请先重新扫描。");
    }
    const configuration = await this.ensureConfiguration();
    const sourcePath = this.resolveCategoryFile(category, issue.storedName);
    const file = await this.fileStat(sourcePath, "孤立文件不存在，可能已经被清理。");
    const trashStoredName = `${randomUUID()}${this.safeExtension(issue.storedName)}`;
    const trashPath = this.resolveTrashFile(category, trashStoredName);
    await mkdir(dirname(trashPath), { recursive: true });
    await this.moveFile(sourcePath, trashPath);

    try {
      const purgeAfter = new Date(Date.now() + configuration.trashRetentionDays * 86_400_000);
      const item = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.storageTrashItem.create({
          data: {
            category,
            originalStoredName: issue.storedName,
            trashStoredName,
            mimeType: issue.mimeType || this.mimeTypeForName(issue.storedName),
            sizeBytes: file.size,
            trashedById: actorId,
            purgeAfter,
          },
        });
        await transaction.storageScanIssue.update({
          where: { id: issue.id },
          data: { resolvedAt: new Date(), resolution: "trashed" },
        });
        return created;
      });
      return this.toTrashResponse(item);
    } catch (error) {
      await mkdir(dirname(sourcePath), { recursive: true });
      await this.moveFile(trashPath, sourcePath).catch(() => undefined);
      throw error;
    }
  }

  async restoreTrash(id: number): Promise<{ success: true }> {
    const item = await this.prisma.storageTrashItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("回收站文件不存在。");
    const category = this.normalizeCategory(item.category);
    const sourcePath = this.resolveTrashFile(category, item.trashStoredName);
    const destinationPath = this.resolveCategoryFile(category, item.originalStoredName);
    await this.fileStat(sourcePath, "回收站文件已经不存在。");
    if (await this.pathExists(destinationPath)) {
      throw new ConflictException("原位置已经存在同名文件，无法恢复。");
    }
    await mkdir(dirname(destinationPath), { recursive: true });
    await this.moveFile(sourcePath, destinationPath);
    try {
      await this.prisma.storageTrashItem.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      await this.moveFile(destinationPath, sourcePath).catch(() => undefined);
      throw error;
    }
  }

  async deleteTrash(id: number): Promise<{ success: true }> {
    const item = await this.prisma.storageTrashItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("回收站文件不存在。");
    const filePath = this.resolveTrashFile(this.normalizeCategory(item.category), item.trashStoredName);
    await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await this.prisma.storageTrashItem.delete({ where: { id } });
    return { success: true };
  }

  private async initializeScheduler(): Promise<void> {
    await this.prisma.storageScan.updateMany({
      where: { status: StorageScanStatus.running },
      data: {
        status: StorageScanStatus.failed,
        error: "服务重启，未完成的扫描任务已终止。",
        completedAt: new Date(),
      },
    }).catch(() => undefined);
    await this.runScheduler();
  }

  private async runScheduler(): Promise<void> {
    if (this.schedulerRunning) return;
    this.schedulerRunning = true;
    try {
      if (Date.now() - this.lastPurgeCheckAt >= 60 * 60 * 1000) {
        this.lastPurgeCheckAt = Date.now();
        await this.purgeExpiredTrash();
      }
      const configuration = await this.ensureConfiguration();
      if (!configuration.automaticScanEnabled || this.activeScanPromise) return;
      const now = new Date();
      const dateKey = this.zonedDateKey(now, configuration.timezone);
      if (this.zonedTime(now, configuration.timezone) < configuration.scanTime) return;
      if (configuration.lastScheduledScanDate === dateKey) return;
      await this.startScan(null, StorageScanTrigger.scheduled);
      await this.prisma.storageManagementConfiguration.update({
        where: { id: 1 },
        data: { lastScheduledScanDate: dateKey },
      });
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        this.logger.warn(`Storage scheduler failed: ${this.errorMessage(error)}`);
      }
    } finally {
      this.schedulerRunning = false;
    }
  }

  private async performScan(scanId: number): Promise<void> {
    try {
      const [references, trashRows, repairRows] = await Promise.all([
        this.loadReferences(),
        this.prisma.storageTrashItem.findMany({ select: { category: true, sizeBytes: true } }),
        this.prisma.storageFileRepair.findMany({
          where: { status: StorageRepairStatus.completed },
          orderBy: { id: "desc" },
          select: {
            category: true,
            storedName: true,
            action: true,
          },
        }),
      ]);
      const referencesByCategory = new Map<StorageCategoryKey, Map<string, StorageReference>>();
      for (const category of this.categories) referencesByCategory.set(category.key, new Map());
      for (const reference of references) {
        referencesByCategory.get(reference.category)?.set(reference.storedName, reference);
      }
      const trashByCategory = new Map<StorageCategoryKey, { count: number; sizeBytes: number }>();
      for (const category of this.categories) trashByCategory.set(category.key, { count: 0, sizeBytes: 0 });
      for (const item of trashRows) {
        const category = this.categoryOrNull(item.category);
        if (!category) continue;
        const current = trashByCategory.get(category)!;
        current.count += 1;
        current.sizeBytes += item.sizeBytes;
      }
      const latestRepairByFile = new Map<string, StorageRepairAction>();
      for (const repair of repairRows) {
        const key = `${repair.category}\u0000${repair.storedName}`;
        if (!latestRepairByFile.has(key)) {
          latestRepairByFile.set(key, repair.action);
        }
      }
      const confirmedUnrecoverable = new Set(
        [...latestRepairByFile.entries()]
          .filter(([, action]) => action === StorageRepairAction.confirm_unrecoverable)
          .map(([key]) => key),
      );

      const issues: Prisma.StorageScanIssueCreateManyInput[] = [];
      const summaries: StorageCategorySummary[] = [];
      const mediaBackupFiles: MediaBackupCatalogFile[] = [];
      let scannedFileCount = 0;
      for (const category of this.categories) {
        const result = await this.scanCategory(
          scanId,
          category,
          referencesByCategory.get(category.key) ?? new Map(),
          trashByCategory.get(category.key) ?? { count: 0, sizeBytes: 0 },
          issues,
          mediaBackupFiles,
          confirmedUnrecoverable,
        );
        scannedFileCount += result.fileCount;
        if (scannedFileCount > MAX_SCANNED_FILES) {
          throw new BadRequestException(`存储文件超过 ${MAX_SCANNED_FILES} 个，已停止扫描以保护服务器。`);
        }
        summaries.push(result);
      }
      const catalogResult = await this.mediaBackupCatalog.synchronize(mediaBackupFiles);
      this.logger.log(`Media backup catalog synchronized ${catalogResult.totalFiles} files across six categories.`);
      const summary = this.buildSummary(summaries, await this.diskUsage());

      await this.prisma.$transaction(async (transaction) => {
        for (let offset = 0; offset < issues.length; offset += 500) {
          await transaction.storageScanIssue.createMany({ data: issues.slice(offset, offset + 500) });
        }
        await transaction.storageScan.update({
          where: { id: scanId },
          data: {
            status: StorageScanStatus.completed,
            summary: summary as unknown as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });
        await transaction.storageManagementConfiguration.upsert({
          where: { id: 1 },
          create: { id: 1, lastScanAt: new Date() },
          update: { lastScanAt: new Date() },
        });
      });
      await this.notifyStorageWarning(scanId, summary);
      await this.pruneScans();
    } catch (error) {
      await this.prisma.storageScan.update({
        where: { id: scanId },
        data: {
          status: StorageScanStatus.failed,
          error: this.errorMessage(error),
          completedAt: new Date(),
        },
      }).catch(() => undefined);
      throw error;
    }
  }

  private async scanCategory(
    scanId: number,
    category: StorageCategoryDefinition,
    references: Map<string, StorageReference>,
    trash: { count: number; sizeBytes: number },
    issues: Prisma.StorageScanIssueCreateManyInput[],
    mediaBackupFiles: MediaBackupCatalogFile[],
    confirmedUnrecoverable: Set<string>,
  ): Promise<StorageCategorySummary> {
    let files: ScannedFile[];
    try {
      await mkdir(category.directory, { recursive: true });
      files = await this.listFiles(category.directory);
    } catch {
      for (const reference of references.values()) {
        issues.push(this.issueData(
          scanId,
          StorageIssueKind.missing,
          reference,
          null,
          confirmedUnrecoverable.has(`${reference.category}\u0000${reference.storedName}`),
        ));
      }
      return {
        key: category.key,
        label: category.label,
        available: false,
        sizeBytes: 0,
        fileCount: 0,
        referencedCount: references.size,
        healthyCount: 0,
        missingCount: references.size,
        orphanCount: 0,
        mismatchCount: 0,
        protectedTemporaryCount: 0,
        trashCount: trash.count,
        trashBytes: trash.sizeBytes,
      };
    }

    const filesByName = new Map(files.map((file) => [file.relativeName, file]));
    let healthyCount = 0;
    let missingCount = 0;
    let mismatchCount = 0;
    for (const reference of references.values()) {
      const file = filesByName.get(reference.storedName);
      if (!file) {
        missingCount += 1;
        issues.push(this.issueData(
          scanId,
          StorageIssueKind.missing,
          reference,
          null,
          confirmedUnrecoverable.has(`${reference.category}\u0000${reference.storedName}`),
        ));
        continue;
      }
      // Missing and orphaned files stay in the repair workflow instead of becoming backup candidates.
      mediaBackupFiles.push({
        category: reference.category,
        storedName: reference.storedName,
        mimeType: reference.mimeType,
        sourceType: reference.sourceType,
        sourceId: reference.sourceId,
        sourceLabel: reference.sourceLabel,
        sourceUrl: reference.sourceUrl,
        uploadedBy: reference.uploadedBy,
        sizeBytes: file.sizeBytes,
        fileUpdatedAt: file.updatedAt,
      });
      filesByName.delete(reference.storedName);
      if (reference.category === "chat") {
        // Chat thumbnails are reproducible derivatives of a healthy attachment,
        // so they count toward disk usage but are not standalone orphan files.
        filesByName.delete(`${reference.storedName}.thumb.webp`);
      }
      if (reference.sizeBytes !== null && reference.sizeBytes !== file.sizeBytes) {
        mismatchCount += 1;
        issues.push(this.issueData(scanId, StorageIssueKind.metadata_mismatch, reference, file));
      } else {
        healthyCount += 1;
      }
    }

    let orphanCount = 0;
    let protectedTemporaryCount = 0;
    const now = Date.now();
    for (const file of filesByName.values()) {
      const isTemporary = file.relativeName.startsWith(".tmp/");
      if (isTemporary && now - file.updatedAt.getTime() < TEMPORARY_FILE_PROTECTION_MS) {
        protectedTemporaryCount += 1;
        continue;
      }
      orphanCount += 1;
      const reference: StorageReference = {
        category: category.key,
        storedName: file.relativeName,
        mimeType: this.mimeTypeForName(file.relativeName),
        sizeBytes: null,
        sourceType: isTemporary ? "temporary_upload" : "unreferenced_file",
        sourceId: null,
        sourceLabel: isTemporary ? "超过 24 小时的临时上传文件" : "数据库中没有对应记录",
        sourceUrl: null,
        uploadedBy: null,
      };
      issues.push(this.issueData(scanId, StorageIssueKind.orphan, reference, file));
    }

    return {
      key: category.key,
      label: category.label,
      available: true,
      sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      fileCount: files.length,
      referencedCount: references.size,
      healthyCount,
      missingCount,
      orphanCount,
      mismatchCount,
      protectedTemporaryCount,
      trashCount: trash.count,
      trashBytes: trash.sizeBytes,
    };
  }

  private issueData(
    scanId: number,
    kind: StorageIssueKind,
    reference: StorageReference,
    file: ScannedFile | null,
    confirmedUnrecoverable = false,
  ): Prisma.StorageScanIssueCreateManyInput {
    return {
      scanId,
      kind,
      category: reference.category,
      storedName: reference.storedName,
      mimeType: reference.mimeType,
      expectedSizeBytes: reference.sizeBytes,
      actualSizeBytes: file?.sizeBytes ?? null,
      sourceType: reference.sourceType,
      sourceId: reference.sourceId,
      sourceLabel: reference.sourceLabel.slice(0, 255),
      sourceUrl: reference.sourceUrl,
      uploadedBy: reference.uploadedBy,
      fileUpdatedAt: file?.updatedAt ?? null,
      ...(confirmedUnrecoverable
        ? {
            resolvedAt: new Date(),
            resolution: "confirmed_unrecoverable",
          }
        : {}),
    };
  }

  private async loadReferences(): Promise<StorageReference[]> {
    const references: StorageReference[] = [];
    const backgrounds = await this.prisma.backgroundImage.findMany({
      select: {
        id: true,
        originalName: true,
        storedName: true,
        mimeType: true,
        sizeBytes: true,
        isActive: true,
        uploadedBy: { select: { username: true } },
      },
    });
    references.push(...backgrounds.map((item) => ({
      category: "backgrounds" as const,
      storedName: item.storedName,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      sourceType: "background",
      sourceId: String(item.id),
      sourceLabel: `${item.isActive ? "当前背景 · " : ""}${item.originalName}`,
      sourceUrl: "/admin/settings#backgrounds",
      uploadedBy: item.uploadedBy.username,
    })));

    const siteAssets = await this.prisma.siteAsset.findMany({
      select: {
        id: true,
        kind: true,
        originalName: true,
        storedName: true,
        mimeType: true,
        sizeBytes: true,
        uploadedBy: { select: { username: true } },
      },
    });
    references.push(...siteAssets.map((item) => ({
      category: "site-assets" as const,
      storedName: item.storedName,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      sourceType: `site_asset_${item.kind}`,
      sourceId: String(item.id),
      sourceLabel: item.originalName,
      sourceUrl: "/admin/settings#site-assets",
      uploadedBy: item.uploadedBy.username,
    })));

    const releases = await this.prisma.androidRelease.findMany({
      select: {
        id: true,
        versionName: true,
        originalName: true,
        storedName: true,
        mimeType: true,
        sizeBytes: true,
        uploadedBy: { select: { username: true } },
      },
    });
    references.push(...releases.map((item) => ({
      category: "android-releases" as const,
      storedName: item.storedName,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      sourceType: "android_release",
      sourceId: String(item.id),
      sourceLabel: `${item.versionName} · ${item.originalName}`,
      sourceUrl: "/admin/android",
      uploadedBy: item.uploadedBy.username,
    })));

    const avatars = await this.prisma.user.findMany({
      where: { avatarStoredName: { not: null } },
      select: {
        id: true,
        username: true,
        nickname: true,
        avatarStoredName: true,
        avatarMimeType: true,
        avatarSizeBytes: true,
      },
    });
    references.push(...avatars.flatMap((item) => item.avatarStoredName ? [{
      category: "avatars" as const,
      storedName: item.avatarStoredName,
      mimeType: item.avatarMimeType,
      sizeBytes: item.avatarSizeBytes,
      sourceType: "user_avatar",
      sourceId: String(item.id),
      sourceLabel: `${item.nickname} (@${item.username})`,
      sourceUrl: `/users/${encodeURIComponent(item.username)}`,
      uploadedBy: item.username,
    }] : []));

    const articleImages = await this.prisma.articleImage.findMany({
      select: {
        id: true,
        originalName: true,
        storedName: true,
        mimeType: true,
        sizeBytes: true,
        article: { select: { title: true, slug: true, author: { select: { username: true } } } },
      },
    });
    references.push(...articleImages.map((item) => ({
      category: "articles" as const,
      storedName: item.storedName,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      sourceType: "article_image",
      sourceId: String(item.id),
      sourceLabel: `${item.article.title} · ${item.originalName}`,
      sourceUrl: `/articles/${item.article.slug}`,
      uploadedBy: item.article.author.username,
    })));

    const topicCovers = await this.prisma.articleTopic.findMany({
      where: { coverStoredName: { not: null } },
      select: {
        id: true,
        title: true,
        coverOriginalName: true,
        coverStoredName: true,
        coverMimeType: true,
        coverSizeBytes: true,
        updatedBy: { select: { username: true } },
      },
    });
    references.push(...topicCovers.flatMap((item) => item.coverStoredName ? [{
      category: "articles" as const,
      storedName: `topic-covers/${item.coverStoredName}`,
      mimeType: item.coverMimeType,
      sizeBytes: item.coverSizeBytes,
      sourceType: "topic_cover",
      sourceId: String(item.id),
      sourceLabel: `${item.title} · ${item.coverOriginalName ?? item.coverStoredName}`,
      sourceUrl: "/admin/topics",
      uploadedBy: item.updatedBy?.username ?? null,
    }] : []));

    const collectionCovers = await this.prisma.articleCollection.findMany({
      where: { coverStoredName: { not: null } },
      select: {
        id: true,
        name: true,
        coverOriginalName: true,
        coverStoredName: true,
        coverMimeType: true,
        coverSizeBytes: true,
        owner: { select: { username: true } },
      },
    });
    references.push(...collectionCovers.flatMap((item) => item.coverStoredName ? [{
      category: "articles" as const,
      storedName: `collection-covers/${item.coverStoredName}`,
      mimeType: item.coverMimeType,
      sizeBytes: item.coverSizeBytes,
      sourceType: "collection_cover",
      sourceId: String(item.id),
      sourceLabel: `${item.name} · ${item.coverOriginalName ?? item.coverStoredName}`,
      sourceUrl: `/collections/${item.id}`,
      uploadedBy: item.owner.username,
    }] : []));

    const attachments = await this.prisma.chatAttachment.findMany({
      where: { messageId: { not: null } },
      select: {
        id: true,
        conversationId: true,
        messageId: true,
        originalName: true,
        storedName: true,
        mimeType: true,
        sizeBytes: true,
        uploadedBy: { select: { username: true } },
      },
    });
    references.push(...attachments.map((item) => ({
      category: "chat" as const,
      storedName: item.storedName,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      sourceType: "chat_attachment",
      sourceId: String(item.id),
      sourceLabel: `会话 #${item.conversationId} · 消息 #${item.messageId} · ${item.originalName}`,
      sourceUrl: null,
      uploadedBy: item.uploadedBy.username,
    })));
    return references;
  }

  private async listFiles(root: string): Promise<ScannedFile[]> {
    const files: ScannedFile[] = [];
    const walk = async (directory: string): Promise<void> => {
      if (files.length > MAX_SCANNED_FILES) return;
      const handle = await opendir(directory);
      for await (const entry of handle) {
        if (files.length > MAX_SCANNED_FILES) return;
        const fullPath = join(directory, entry.name);
        const relativeName = relative(root, fullPath).split(sep).join("/");
        if (relativeName === ".trash" || relativeName.startsWith(".trash/")) continue;
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const file = await stat(fullPath);
        files.push({ relativeName, fullPath, sizeBytes: file.size, updatedAt: file.mtime });
        if (files.length > MAX_SCANNED_FILES) return;
      }
    };
    await walk(root);
    return files;
  }

  private buildSummary(
    categories: StorageCategorySummary[],
    disk: StorageScanSummary["disk"],
  ): StorageScanSummary {
    return {
      generatedAt: new Date().toISOString(),
      disk,
      totalBytes: categories.reduce((total, item) => total + item.sizeBytes, 0),
      totalFiles: categories.reduce((total, item) => total + item.fileCount, 0),
      referencedCount: categories.reduce((total, item) => total + item.referencedCount, 0),
      healthyCount: categories.reduce((total, item) => total + item.healthyCount, 0),
      missingCount: categories.reduce((total, item) => total + item.missingCount, 0),
      orphanCount: categories.reduce((total, item) => total + item.orphanCount, 0),
      mismatchCount: categories.reduce((total, item) => total + item.mismatchCount, 0),
      protectedTemporaryCount: categories.reduce((total, item) => total + item.protectedTemporaryCount, 0),
      trashCount: categories.reduce((total, item) => total + item.trashCount, 0),
      trashBytes: categories.reduce((total, item) => total + item.trashBytes, 0),
      categories,
    };
  }

  private async diskUsage(): Promise<StorageScanSummary["disk"]> {
    for (const category of this.categories) {
      try {
        const fileSystem = await statfs(category.directory);
        const capacityBytes = fileSystem.blocks * fileSystem.bsize;
        const availableBytes = fileSystem.bavail * fileSystem.bsize;
        const usedBytes = Math.max(0, capacityBytes - fileSystem.bfree * fileSystem.bsize);
        return {
          capacityBytes,
          usedBytes,
          availableBytes,
          usedPercent: capacityBytes > 0 ? Math.round((usedBytes / capacityBytes) * 1000) / 10 : null,
        };
      } catch {
        continue;
      }
    }
    return { capacityBytes: null, usedBytes: null, availableBytes: null, usedPercent: null };
  }

  private async notifyStorageWarning(
    scanId: number,
    summary: StorageScanSummary,
  ): Promise<void> {
    const configuration = await this.ensureConfiguration();
    const previousScan = await this.prisma.storageScan.findFirst({
      where: {
        id: { lt: scanId },
        status: StorageScanStatus.completed,
      },
      orderBy: { id: "desc" },
      select: { summary: true },
    });
    const previousSummary = previousScan?.summary as unknown as
      | StorageScanSummary
      | null;
    const previousMissingCount = previousSummary?.missingCount ?? 0;
    const missingChanged = previousMissingCount !== summary.missingCount;
    const diskWarning =
      summary.disk.usedPercent !== null &&
      summary.disk.usedPercent >= configuration.warningThresholdPercent;
    const previousDiskUsedPercent = previousSummary?.disk?.usedPercent ?? null;
    const previousDiskWarning =
      previousDiskUsedPercent !== null &&
      previousDiskUsedPercent >= configuration.warningThresholdPercent;
    const diskThresholdCrossed = diskWarning && !previousDiskWarning;
    if (!diskThresholdCrossed && !missingChanged) return;
    const administrators = await this.prisma.user.findMany({
      where: { isSuperAdmin: true, status: UserStatus.active },
      select: { id: true },
    });
    if (!administrators.length) return;
    const details = [
      diskThresholdCrossed
        ? `磁盘已使用 ${summary.disk.usedPercent}%，超过 ${configuration.warningThresholdPercent}% 预警线`
        : null,
      missingChanged
        ? `缺失文件由 ${previousMissingCount} 个变为 ${summary.missingCount} 个`
        : null,
    ].filter(Boolean).join("，");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.userNotification.createMany({
        data: administrators.map(({ id }) => ({
          userId: id,
          type: UserNotificationType.system,
          channel: UserNotificationChannel.system,
          title: diskThresholdCrossed ? "存储空间达到预警线" : "缺失文件数量发生变化",
          body: `${details}。请进入存储管理核查。`.slice(0, 500),
          actionUrl: `/admin/storage?scan=${scanId}`,
        })),
      });
      await transaction.storageManagementConfiguration.update({
        where: { id: 1 },
        data: { lastWarningAt: new Date() },
      });
    });
  }

  private async countLatestIssues(kind: StorageIssueKind): Promise<number> {
    const scan = await this.prisma.storageScan.findFirst({
      where: { status: StorageScanStatus.completed },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (!scan) return 0;
    return this.prisma.storageScanIssue.count({ where: { scanId: scan.id, kind, resolvedAt: null } });
  }

  private async openOrphanIssue(id: number) {
    const issue = await this.prisma.storageScanIssue.findUnique({ where: { id } });
    if (!issue || issue.resolvedAt || issue.kind !== StorageIssueKind.orphan) {
      throw new NotFoundException("可处理的孤立文件记录不存在。");
    }
    this.normalizeCategory(issue.category);
    return issue;
  }

  private async isReferenced(category: StorageCategoryKey, storedName: string): Promise<boolean> {
    switch (category) {
      case "backgrounds":
        return Boolean(await this.prisma.backgroundImage.findUnique({ where: { storedName }, select: { id: true } }));
      case "site-assets":
        return Boolean(await this.prisma.siteAsset.findUnique({ where: { storedName }, select: { id: true } }));
      case "android-releases":
        return Boolean(await this.prisma.androidRelease.findUnique({ where: { storedName }, select: { id: true } }));
      case "avatars":
        return Boolean(await this.prisma.user.findUnique({ where: { avatarStoredName: storedName }, select: { id: true } }));
      case "articles":
        if (storedName.startsWith("topic-covers/")) {
          return Boolean(await this.prisma.articleTopic.findUnique({
            where: { coverStoredName: basename(storedName) },
            select: { id: true },
          }));
        }
        if (storedName.startsWith("collection-covers/")) {
          return Boolean(await this.prisma.articleCollection.findUnique({
            where: { coverStoredName: basename(storedName) },
            select: { id: true },
          }));
        }
        return Boolean(await this.prisma.articleImage.findUnique({ where: { storedName }, select: { id: true } }));
      case "chat":
        return Boolean(await this.prisma.chatAttachment.findUnique({ where: { storedName }, select: { id: true } }));
    }
  }

  private async purgeExpiredTrash(): Promise<void> {
    const items = await this.prisma.storageTrashItem.findMany({
      where: { purgeAfter: { lte: new Date() } },
      orderBy: { purgeAfter: "asc" },
      take: 100,
    });
    for (const item of items) {
      const category = this.categoryOrNull(item.category);
      if (!category) continue;
      const filePath = this.resolveTrashFile(category, item.trashStoredName);
      await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await this.prisma.storageTrashItem.delete({ where: { id: item.id } });
    }
  }

  private async pruneScans(): Promise<void> {
    const obsolete = await this.prisma.storageScan.findMany({
      where: { status: { not: StorageScanStatus.running } },
      orderBy: { id: "desc" },
      skip: RETAINED_SCAN_COUNT,
      select: { id: true },
    });
    if (obsolete.length) {
      await this.prisma.storageScan.deleteMany({ where: { id: { in: obsolete.map(({ id }) => id) } } });
    }
  }

  private ensureConfiguration() {
    return this.prisma.storageManagementConfiguration.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  private toConfigurationResponse(configuration: {
    automaticScanEnabled: boolean;
    scanTime: string;
    timezone: string;
    trashRetentionDays: number;
    warningThresholdPercent: number;
    lastScheduledScanDate: string | null;
    lastScanAt: Date | null;
    lastWarningAt: Date | null;
  }): StorageManagementConfigurationResponse {
    return {
      automaticScanEnabled: configuration.automaticScanEnabled,
      scanTime: configuration.scanTime,
      timezone: configuration.timezone,
      trashRetentionDays: configuration.trashRetentionDays,
      warningThresholdPercent: configuration.warningThresholdPercent,
      nextRunAt: configuration.automaticScanEnabled ? this.nextScheduledRun(configuration) : null,
      lastScheduledScanDate: configuration.lastScheduledScanDate,
      lastScanAt: configuration.lastScanAt?.toISOString() ?? null,
      lastWarningAt: configuration.lastWarningAt?.toISOString() ?? null,
    };
  }

  private toScanResponse(scan: {
    id: number;
    status: StorageScanStatus;
    trigger: StorageScanTrigger;
    triggeredById: number | null;
    summary: Prisma.JsonValue | null;
    error: string | null;
    startedAt: Date;
    completedAt: Date | null;
  }): StorageScanResponse {
    return {
      id: scan.id,
      status: scan.status,
      trigger: scan.trigger,
      triggeredById: scan.triggeredById,
      summary: scan.summary as unknown as StorageScanSummary | null,
      error: scan.error,
      startedAt: scan.startedAt.toISOString(),
      completedAt: scan.completedAt?.toISOString() ?? null,
    };
  }

  private toIssueResponse(issue: {
    id: number;
    scanId: number;
    kind: StorageIssueKind;
    category: string;
    storedName: string;
    mimeType: string | null;
    expectedSizeBytes: number | null;
    actualSizeBytes: number | null;
    sourceType: string;
    sourceId: string | null;
    sourceLabel: string;
    sourceUrl: string | null;
    uploadedBy: string | null;
    fileUpdatedAt: Date | null;
    resolvedAt: Date | null;
    createdAt: Date;
  }): StorageIssueResponse {
    const category = this.normalizeCategory(issue.category);
    return {
      id: issue.id,
      scanId: issue.scanId,
      kind: issue.kind,
      category,
      categoryLabel: this.categoryDefinition(category).label,
      storedName: issue.storedName,
      mimeType: issue.mimeType,
      expectedSizeBytes: issue.expectedSizeBytes,
      actualSizeBytes: issue.actualSizeBytes,
      sourceType: issue.sourceType,
      sourceId: issue.sourceId,
      sourceLabel: issue.sourceLabel,
      sourceUrl: issue.sourceUrl,
      uploadedBy: issue.uploadedBy,
      fileUpdatedAt: issue.fileUpdatedAt?.toISOString() ?? null,
      previewable: issue.kind === StorageIssueKind.orphan && this.isPreviewable(issue.storedName),
      canTrash: issue.kind === StorageIssueKind.orphan && !issue.resolvedAt,
      createdAt: issue.createdAt.toISOString(),
    };
  }

  private toTrashResponse(item: {
    id: number;
    category: string;
    originalStoredName: string;
    mimeType: string | null;
    sizeBytes: number;
    trashedById: number | null;
    deletedAt: Date;
    purgeAfter: Date;
  }): StorageTrashItemResponse {
    const category = this.normalizeCategory(item.category);
    return {
      id: item.id,
      category,
      categoryLabel: this.categoryDefinition(category).label,
      originalStoredName: item.originalStoredName,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      trashedById: item.trashedById,
      deletedAt: item.deletedAt.toISOString(),
      purgeAfter: item.purgeAfter.toISOString(),
    };
  }

  private resolveCategoryFile(category: StorageCategoryKey, relativeName: string): string {
    const definition = this.categoryDefinition(category);
    const normalized = relativeName.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new BadRequestException("存储文件路径无效。");
    }
    const filePath = resolve(definition.directory, ...normalized.split("/"));
    if (!filePath.startsWith(`${definition.directory}${sep}`)) {
      throw new BadRequestException("存储文件路径无效。");
    }
    return filePath;
  }

  private resolveTrashFile(category: StorageCategoryKey, trashStoredName: string): string {
    if (basename(trashStoredName) !== trashStoredName || !/^[0-9a-f-]{36}(?:\.[A-Za-z0-9]{1,8})?$/.test(trashStoredName)) {
      throw new BadRequestException("回收站文件名无效。");
    }
    return join(this.categoryDefinition(category).directory, ".trash", trashStoredName);
  }

  private categoryDefinition(category: StorageCategoryKey): StorageCategoryDefinition {
    const definition = this.categories.find((item) => item.key === category);
    if (!definition) throw new BadRequestException("存储分类无效。");
    return definition;
  }

  private normalizeCategory(category: string): StorageCategoryKey {
    const normalized = this.categoryOrNull(category);
    if (!normalized) throw new BadRequestException("存储分类无效。");
    return normalized;
  }

  private categoryOrNull(category: string): StorageCategoryKey | null {
    return this.categories.some((item) => item.key === category) ? category as StorageCategoryKey : null;
  }

  private mimeTypeForName(name: string): string {
    const extension = extname(name).toLowerCase();
    return ({
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".avif": "image/avif",
      ".gif": "image/gif",
      ".apk": "application/vnd.android.package-archive",
    } as Record<string, string>)[extension] ?? "application/octet-stream";
  }

  private isPreviewable(name: string): boolean {
    return [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"].includes(extname(name).toLowerCase());
  }

  private safeExtension(name: string): string {
    const extension = extname(name).toLowerCase();
    return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
  }

  private async moveFile(source: string, destination: string): Promise<void> {
    try {
      await rename(source, destination);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EXDEV")) throw error;
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

  private zonedDateKey(date: Date, timezone: string): string {
    const parts = this.zonedParts(date, timezone);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  private zonedTime(date: Date, timezone: string): string {
    const parts = this.zonedParts(date, timezone);
    return `${parts.hour}:${parts.minute}`;
  }

  private zonedParts(date: Date, timezone: string): Record<"year" | "month" | "day" | "hour" | "minute", string> {
    const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return values as Record<"year" | "month" | "day" | "hour" | "minute", string>;
  }

  private nextScheduledRun(configuration: { scanTime: string; timezone: string; lastScheduledScanDate: string | null }): string {
    const now = new Date();
    const dateKey = this.zonedDateKey(now, configuration.timezone);
    const offset = this.timezoneOffset(now, configuration.timezone);
    let candidate = new Date(`${dateKey}T${configuration.scanTime}:00${offset}`);
    if (candidate <= now || configuration.lastScheduledScanDate === dateKey) {
      candidate = new Date(candidate.getTime() + 86_400_000);
    }
    return candidate.toISOString();
  }

  private timezoneOffset(date: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    }).formatToParts(date);
    const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
    return value.replace("GMT", "") || "+00:00";
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : "存储扫描失败。")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 500);
  }
}
