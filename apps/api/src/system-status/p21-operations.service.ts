import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BackupService } from "./backup.service";
import { StorageManagementService } from "./storage-management.service";
import {
  OperationalAlertQueryDto,
  OperationalRunQueryDto,
  StartRecoveryDrillDto,
  UpdateAuditRetentionPolicyDto,
} from "./dto/p21-operations.dto";
import type {
  AuditRetentionPolicyResponse,
  DependencyAssessmentResponse,
  DisasterRecoveryTargetResponse,
  OperationalAlertResponse,
  OperationalRunResponse,
  P21OperationsOverviewResponse,
} from "./p21-operations.types";

const DEFAULT_AUDIT_POLICY = {
  cleanupEnabled: true,
  businessDays: 180,
  securityDays: 365,
  serverDays: 90,
};

const RECOVERY_TARGETS: DisasterRecoveryTargetResponse[] = [
  { name: "恢复点目标", target: "24 小时", current: "以最近一次成功备份为准", status: "defined", measurement: "备份成功时间" },
  { name: "恢复时间目标", target: "30 分钟", current: "按手册演练记录", status: "defined", measurement: "从故障确认到服务恢复" },
  { name: "媒体完整性", target: "100% 哈希通过", current: "每个清单文件逐项 SHA-256 校验", status: "defined", measurement: "媒体备份清单" },
  { name: "接口降级", target: "不重复写入", current: "GET/HEAD 可重试，写请求不自动重试", status: "defined", measurement: "P20 弱网策略" },
];

@Injectable()
export class P21OperationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(P21OperationsService.name);
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupService,
    private readonly storage: StorageManagementService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    setTimeout(() => void this.cleanupAuditLogs().catch((error) => this.logger.warn(`Audit cleanup failed: ${this.errorMessage(error)}`)), 30_000).unref();
    this.cleanupTimer = setInterval(() => void this.cleanupAuditLogs().catch((error) => this.logger.warn(`Audit cleanup failed: ${this.errorMessage(error)}`)), 6 * 60 * 60 * 1_000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async getOverview(): Promise<P21OperationsOverviewResponse> {
    await this.refreshAlerts();
    const [auditPolicy, alerts, runs, dependencyAssessment, backupConfiguration] = await Promise.all([
      this.getAuditPolicy(),
      this.listAlerts({ limit: 20 }),
      this.listRuns({ limit: 20 }),
      this.getDependencyAssessment(),
      this.backups.getConfiguration(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      auditPolicy,
      alerts,
      runs,
      dependencyAssessment,
      recoveryTargets: RECOVERY_TARGETS,
      externalStorage: {
        ossConfigured: backupConfiguration.oss.enabled && backupConfiguration.oss.hasAccessKeyId && backupConfiguration.oss.hasSecretAccessKey,
        r2Configured: backupConfiguration.r2.enabled && backupConfiguration.r2.hasAccessKeyId && backupConfiguration.r2.hasSecretAccessKey,
        encryptionConfigured: backupConfiguration.encryptionConfigured,
        message: backupConfiguration.encryptionConfigured
          ? "远端存储可在备份策略中配置；未配置提供商时，恢复演练会明确记录为阻塞。"
          : "尚未配置 BACKUP_ENCRYPTION_KEY，OSS/R2 远端备份和恢复演练暂不可执行。",
      },
    };
  }

  async listRuns(query: OperationalRunQueryDto): Promise<OperationalRunResponse[]> {
    const items = await this.prisma.operationalRun.findMany({
      where: {
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit,
    });
    return items.map((item) => this.toRunResponse(item));
  }

  async listAlerts(query: OperationalAlertQueryDto): Promise<OperationalAlertResponse[]> {
    const items = await this.prisma.operationalAlert.findMany({
      where: query.status ? { status: query.status } : { status: { not: "resolved" } },
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      take: query.limit,
    });
    return items.map((item) => this.toAlertResponse(item));
  }

  async runAlertCheck(actorId: number): Promise<OperationalRunResponse> {
    const startedAt = new Date();
    const run = await this.prisma.operationalRun.create({
      data: {
        kind: "alert_check",
        status: "running",
        summary: "正在检查备份、磁盘和存储异常。",
        actorId,
        startedAt,
      },
    });
    try {
      const alerts = await this.refreshAlerts();
      const status = alerts.some((alert) => alert.severity === "critical") ? "failed" : "passed";
      const completed = await this.prisma.operationalRun.update({
        where: { id: run.id },
        data: {
          status,
          summary: status === "passed" ? "告警检查完成，未发现严重异常。" : "告警检查发现严重异常，请按升级路径处理。",
          detail: { alertCount: alerts.length, checkedAt: new Date().toISOString() } as Prisma.InputJsonValue,
          metrics: { openAlerts: alerts.filter((alert) => alert.status !== "resolved").length } as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      return this.toRunResponse(completed);
    } catch (error) {
      const failed = await this.prisma.operationalRun.update({
        where: { id: run.id },
        data: { status: "failed", summary: "告警检查执行失败。", detail: { error: this.errorMessage(error) } as Prisma.InputJsonValue, completedAt: new Date() },
      });
      return this.toRunResponse(failed);
    }
  }

  async runDependencyReview(actorId: number): Promise<OperationalRunResponse> {
    const startedAt = new Date();
    const assessment = await this.getDependencyAssessment();
    const rangeCount = assessment.items.filter((item) => item.status === "range").length;
    const missingCount = assessment.items.filter((item) => item.status === "not-found").length;
    const run = await this.prisma.operationalRun.create({
      data: {
        kind: "dependency_review",
        status: missingCount ? "failed" : "passed",
        summary: missingCount ? "依赖评估完成，但有版本未读取。" : "依赖与运行时版本评估已记录。",
        detail: { source: assessment.source, items: assessment.items } as Prisma.InputJsonValue,
        metrics: { total: assessment.items.length, ranged: rangeCount, missing: missingCount } as Prisma.InputJsonValue,
        actorId,
        startedAt,
        completedAt: new Date(),
      },
    });
    return this.toRunResponse(run);
  }

  async startRecoveryDrill(actorId: number, dto: StartRecoveryDrillDto): Promise<OperationalRunResponse> {
    const run = await this.prisma.operationalRun.create({
      data: {
        kind: "recovery_drill",
        status: "running",
        provider: dto.provider,
        summary: `正在执行 ${this.providerLabel(dto.provider)} 恢复演练。`,
        actorId,
      },
    });
    try {
      const configuration = await this.backups.getConfiguration();
      if (dto.provider !== "local" && !this.providerConfigured(dto.provider, configuration)) {
        const blocked = await this.prisma.operationalRun.update({
          where: { id: run.id },
          data: {
            status: "blocked",
            summary: `${this.providerLabel(dto.provider)} 尚未完成配置，演练未执行。`,
            detail: { reason: "provider_not_configured", nextStep: "在系统概览的备份策略中配置凭证，并先执行连接测试。" } as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });
        return this.toRunResponse(blocked);
      }

      const backup = await this.backups.createBackup();
      const remoteResult = dto.provider === "local"
        ? null
        : backup.remoteResults?.find((result) => result.provider === dto.provider) ?? null;
      const hashVerified = backup.verification.databaseValid === true
        && (backup.mediaSnapshotAvailable ? backup.verification.mediaValid === true : true);
      const remoteVerified = dto.provider === "local" || remoteResult?.status === "success";
      const passed = hashVerified && remoteVerified;
      if (!passed) {
        await this.upsertAlert({
          type: "restore_failure",
          fingerprint: `recovery-drill-${dto.provider}`,
          severity: "critical",
          title: "恢复演练校验失败",
          message: "配对备份或远端对象校验未通过。",
          metadata: { provider: dto.provider, backupName: backup.name },
        });
      }
      const completed = await this.prisma.operationalRun.update({
        where: { id: run.id },
        data: {
          status: passed ? "passed" : "failed",
          summary: passed ? "配对备份创建、媒体快照和哈希校验通过。" : "恢复演练校验未通过，请查看备份清单和远端结果。",
          detail: {
            backupName: backup.name,
            nonDestructive: true,
            restoreAction: "仅执行归档读取、媒体快照和远端对象结果校验，未覆盖生产数据库。",
            remoteResult,
          } as Prisma.InputJsonValue,
          metrics: {
            databaseValid: backup.verification.databaseValid,
            mediaValid: backup.verification.mediaValid,
            mediaFileCount: backup.verification.mediaFileCount,
            hashVerified,
          } as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      return this.toRunResponse(completed);
    } catch (error) {
      const failed = await this.prisma.operationalRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          summary: "恢复演练执行失败。",
          detail: { error: this.errorMessage(error), escalation: "保留失败记录，检查磁盘、数据库客户端和备份目录后重试。" } as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      await this.upsertAlert({
        type: "restore_failure",
        fingerprint: `recovery-drill-${dto.provider}`,
        severity: "critical",
        title: "恢复演练失败",
        message: this.errorMessage(error),
        metadata: { provider: dto.provider },
      });
      this.logger.warn(`Recovery drill failed: ${this.errorMessage(error)}`);
      return this.toRunResponse(failed);
    }
  }

  async acknowledgeAlert(id: number, actorId: number): Promise<OperationalAlertResponse> {
    const item = await this.prisma.operationalAlert.update({
      where: { id },
      data: { status: "acknowledged", acknowledgedAt: new Date(), acknowledgedById: actorId },
    });
    return this.toAlertResponse(item);
  }

  async resolveAlert(id: number): Promise<OperationalAlertResponse> {
    const item = await this.prisma.operationalAlert.update({
      where: { id },
      data: { status: "resolved", resolvedAt: new Date() },
    });
    return this.toAlertResponse(item);
  }

  async getAuditPolicy(): Promise<AuditRetentionPolicyResponse> {
    const policy = await this.prisma.auditRetentionPolicy.upsert({
      where: { id: 1 },
      create: { id: 1, ...DEFAULT_AUDIT_POLICY },
      update: {},
    });
    return this.toAuditPolicyResponse(policy);
  }

  async updateAuditPolicy(dto: UpdateAuditRetentionPolicyDto): Promise<AuditRetentionPolicyResponse> {
    const policy = await this.prisma.auditRetentionPolicy.upsert({
      where: { id: 1 },
      create: { id: 1, ...dto },
      update: dto,
    });
    return this.toAuditPolicyResponse(policy);
  }

  async cleanupAuditLogs(): Promise<{ deletedCount: number; policy: AuditRetentionPolicyResponse }> {
    const policy = await this.prisma.auditRetentionPolicy.upsert({
      where: { id: 1 },
      create: { id: 1, ...DEFAULT_AUDIT_POLICY },
      update: {},
    });
    if (!policy.cleanupEnabled) return { deletedCount: 0, policy: this.toAuditPolicyResponse(policy) };
    const now = Date.now();
    const cutoff = (days: number) => new Date(now - days * 86_400_000);
    const deleted = await this.prisma.auditLog.deleteMany({
      where: {
        OR: [
          { scope: "business", createdAt: { lt: cutoff(policy.businessDays) } },
          { scope: "security", createdAt: { lt: cutoff(policy.securityDays) } },
          { scope: "server", createdAt: { lt: cutoff(policy.serverDays) } },
        ],
      },
    });
    const updated = await this.prisma.auditRetentionPolicy.update({
      where: { id: 1 },
      data: { lastCleanupAt: new Date(), lastCleanupCount: deleted.count },
    });
    return { deletedCount: deleted.count, policy: this.toAuditPolicyResponse(updated) };
  }

  async getDependencyAssessment(): Promise<DependencyAssessmentResponse> {
    const [api, web, compose] = await Promise.all([
      this.readJsonManifest([join(process.cwd(), "package.json"), join(process.cwd(), "apps", "api", "package.json")]),
      this.readJsonManifest([join(process.cwd(), "..", "web", "package.json"), join(process.cwd(), "apps", "web", "package.json")]),
      this.readText([join(process.cwd(), "docker-compose.prod.yml"), join(process.cwd(), "..", "..", "docker-compose.prod.yml")]),
    ]);
    const value = (manifest: Record<string, unknown> | null, name: string): string | null => {
      const dependencies = { ...(manifest?.dependencies as Record<string, string> | undefined), ...(manifest?.devDependencies as Record<string, string> | undefined) };
      return dependencies[name] ?? null;
    };
    const items = [
      this.dependencyItem("Node.js", process.version, null, "runtime", "运行时版本由容器基础镜像提供，升级前需要重新构建并回归 API。"),
      this.dependencyItem("NestJS", value(api, "@nestjs/core"), value(api, "@nestjs/core"), "framework", "API 框架版本来自 apps/api/package.json。"),
      this.dependencyItem("Prisma", value(api, "prisma"), value(api, "prisma"), "framework", "Prisma CLI 与客户端应保持同一主版本。"),
      this.dependencyItem("Next.js", value(web, "next"), value(web, "next"), "framework", "Next 升级需要检查服务端渲染、PWA 和反向代理。"),
      this.dependencyItem("MySQL", this.composeImage(compose, "mysql"), null, "database", "生产数据库升级前必须完成可恢复备份和独立演练。"),
      this.dependencyItem("Redis", this.composeImage(compose, "redis"), null, "cache", "Redis 只保存可重建缓存，升级仍需验证实时聊天和限流。"),
      this.dependencyItem("API base image", this.composeImage(compose, "api"), null, "base-image", "API/Web 镜像通过 GitHub Actions 构建，发布前保留上一镜像回滚。"),
    ];
    return { generatedAt: new Date().toISOString(), source: "package-manifests", items };
  }

  private async refreshAlerts(): Promise<OperationalAlertResponse[]> {
    const [configuration, overview] = await Promise.all([this.backups.getConfiguration(), this.storage.getOverview()]);
    const observed: Array<{ type: string; fingerprint: string; severity: string; title: string; message: string; metadata: Prisma.InputJsonValue }> = [];
    if (configuration.lastFailureMessage) {
      const timedOut = /timeout|超时/i.test(configuration.lastFailureMessage);
      observed.push({ type: timedOut ? "backup_timeout" : "backup_failure", fingerprint: "database-backup", severity: "critical", title: timedOut ? "备份任务超时" : "数据库或远端备份失败", message: configuration.lastFailureMessage, metadata: { lastFailureAt: configuration.lastFailureAt } });
    }
    if (overview.latestScan?.summary?.disk.usedPercent !== null && overview.latestScan?.summary?.disk.usedPercent !== undefined && overview.latestScan.summary.disk.usedPercent >= overview.configuration.warningThresholdPercent) observed.push({ type: "low_disk", fingerprint: "storage-disk", severity: "critical", title: "磁盘空间达到预警线", message: `磁盘使用率 ${overview.latestScan.summary.disk.usedPercent}% 已达到 ${overview.configuration.warningThresholdPercent}% 预警线。`, metadata: { usedPercent: overview.latestScan.summary.disk.usedPercent, thresholdPercent: overview.configuration.warningThresholdPercent } });
    if (overview.openIssues.orphan > 0) observed.push({ type: "orphan_file", fingerprint: "storage-orphan", severity: "warning", title: "发现孤立文件", message: `存储巡检发现 ${overview.openIssues.orphan} 个未被数据库引用的文件。`, metadata: { count: overview.openIssues.orphan } });
    if (overview.openIssues.missing > 0) observed.push({ type: "missing_file", fingerprint: "storage-missing", severity: "critical", title: "发现缺失媒体文件", message: `存储巡检发现 ${overview.openIssues.missing} 个数据库引用但磁盘缺失的文件。`, metadata: { count: overview.openIssues.missing } });
    for (const alert of observed) await this.upsertAlert(alert);
    const observedTypes = new Set(observed.map((item) => item.type));
    const existing = await this.prisma.operationalAlert.findMany({ where: { status: { not: "resolved" } } });
    for (const alert of existing) {
      if (!observedTypes.has(alert.type) && alert.type !== "restore_failure") await this.prisma.operationalAlert.update({ where: { id: alert.id }, data: { status: "resolved", resolvedAt: new Date() } });
    }
    return this.listAlerts({ limit: 20 });
  }

  private async upsertAlert(alert: { type: string; fingerprint: string; severity: string; title: string; message: string; metadata: Prisma.InputJsonValue }) {
    const existing = await this.prisma.operationalAlert.findUnique({
      where: { type_fingerprint: { type: alert.type, fingerprint: alert.fingerprint } },
      select: { status: true },
    });
    return this.prisma.operationalAlert.upsert({
      where: { type_fingerprint: { type: alert.type, fingerprint: alert.fingerprint } },
      create: alert,
      update: {
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        metadata: alert.metadata,
        occurrenceCount: { increment: 1 },
        lastSeenAt: new Date(),
        ...(existing?.status === "open" ? { status: "open", acknowledgedAt: null, resolvedAt: null } : {}),
      },
    });
  }

  private providerConfigured(provider: "oss" | "r2", configuration: Awaited<ReturnType<BackupService["getConfiguration"]>>): boolean {
    return provider === "oss"
      ? configuration.oss.enabled && configuration.oss.hasAccessKeyId && configuration.oss.hasSecretAccessKey && Boolean(configuration.oss.bucket)
      : configuration.r2.enabled && configuration.r2.hasAccessKeyId && configuration.r2.hasSecretAccessKey && Boolean(configuration.r2.bucket);
  }

  private providerLabel(provider: StartRecoveryDrillDto["provider"]): string {
    return provider === "local" ? "本地" : provider === "oss" ? "阿里云 OSS" : "Cloudflare R2";
  }

  private toAuditPolicyResponse(policy: { cleanupEnabled: boolean; businessDays: number; securityDays: number; serverDays: number; lastCleanupAt: Date | null; lastCleanupCount: number }): AuditRetentionPolicyResponse {
    return { cleanupEnabled: policy.cleanupEnabled, businessDays: policy.businessDays, securityDays: policy.securityDays, serverDays: policy.serverDays, lastCleanupAt: policy.lastCleanupAt?.toISOString() ?? null, lastCleanupCount: policy.lastCleanupCount };
  }

  private toRunResponse(item: { id: number; kind: string; status: string; provider: string | null; summary: string; detail: Prisma.JsonValue | null; metrics: Prisma.JsonValue | null; actorId: number | null; startedAt: Date; completedAt: Date | null; createdAt: Date }): OperationalRunResponse {
    return { id: item.id, kind: item.kind, status: item.status, provider: item.provider, summary: item.summary, detail: item.detail, metrics: item.metrics, actorId: item.actorId, startedAt: item.startedAt.toISOString(), completedAt: item.completedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString() };
  }

  private toAlertResponse(item: { id: number; type: string; fingerprint: string; severity: string; status: string; title: string; message: string; metadata: Prisma.JsonValue | null; occurrenceCount: number; firstSeenAt: Date; lastSeenAt: Date; acknowledgedAt: Date | null; resolvedAt: Date | null; createdAt: Date }): OperationalAlertResponse {
    return { id: item.id, type: item.type, fingerprint: item.fingerprint, severity: item.severity, status: item.status, title: item.title, message: item.message, metadata: item.metadata, occurrenceCount: item.occurrenceCount, firstSeenAt: item.firstSeenAt.toISOString(), lastSeenAt: item.lastSeenAt.toISOString(), acknowledgedAt: item.acknowledgedAt?.toISOString() ?? null, resolvedAt: item.resolvedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString() };
  }

  private dependencyItem(name: string, current: string | null, requested: string | null, category: DependencyAssessmentResponse["items"][number]["category"], note: string): DependencyAssessmentResponse["items"][number] {
    return { name, current: current ?? "未读取", requested, category, status: current ? (requested?.startsWith("^") || requested?.startsWith("~") ? "range" : "pinned") : "not-found", note };
  }

  private composeImage(content: string | null, service: string): string | null {
    const match = content?.match(new RegExp(`${service}\\s*:\\s*[\\s\\S]*?image:\\s*([^\\s]+)`));
    return match?.[1] ?? null;
  }

  private async readJsonManifest(paths: string[]): Promise<Record<string, unknown> | null> {
    for (const path of paths) {
      try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; } catch { /* try next known path */ }
    }
    return null;
  }

  private async readText(paths: string[]): Promise<string | null> {
    for (const path of paths) {
      try { return await readFile(path, "utf8"); } catch { /* try next known path */ }
    }
    return null;
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
  }
}
