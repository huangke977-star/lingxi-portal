import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { BackupService } from "./backup.service";
import { StorageManagementService } from "./storage-management.service";
import type { OperationalRunResponse } from "./p21-operations.types";
import type { P22QualityOverviewResponse, QualityCheckResponse, QualityCheckStatus } from "./p22-quality.types";

const BROWSER_CHECKS: P22QualityOverviewResponse["browserChecks"] = [
  {
    id: "public-smoke",
    label: "公开页面冒烟",
    labelEn: "Public page smoke",
    command: "python scripts/p22-browser-smoke.py",
    description: "桌面端和 390px 移动端检查页面状态、控制台错误、图片失败和横向溢出。",
    descriptionEn: "Checks status, console errors, failed images, and horizontal overflow on desktop and 390px mobile.",
  },
  {
    id: "visual-regression",
    label: "视觉回归",
    labelEn: "Visual regression",
    command: "python scripts/p22-browser-smoke.py --baseline-dir scripts/p22-baselines",
    description: "对公开页面生成截图，并与仓库基线进行像素差异检查。",
    descriptionEn: "Captures public pages and compares them with repository visual baselines.",
  },
  {
    id: "release-contract",
    label: "发布契约",
    labelEn: "Release contract",
    command: "pnpm p22:release-check",
    description: "检查健康探针、中文/英文入口、manifest、Service Worker 和关键公开接口。",
    descriptionEn: "Checks health probes, locale entry points, the manifest, the Service Worker, and public read-only endpoints.",
  },
];

@Injectable()
export class P22QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly backups: BackupService,
    private readonly storage: StorageManagementService,
  ) {}

  async getOverview(): Promise<P22QualityOverviewResponse> {
    const latest = await this.prisma.operationalRun.findFirst({
      where: { kind: "quality_check" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const checks = latest?.detail && typeof latest.detail === "object" && !Array.isArray(latest.detail)
      ? this.readChecks((latest.detail as { checks?: unknown }).checks)
      : this.pendingChecks();
    return {
      generatedAt: new Date().toISOString(),
      checks,
      latestRun: latest ? this.toRunResponse(latest) : null,
      browserChecks: BROWSER_CHECKS,
    };
  }

  async runQualityCheck(actorId: number): Promise<OperationalRunResponse> {
    const startedAt = new Date();
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMigrations(),
      this.checkStorage(),
      this.checkBackupConfiguration(),
    ]);
    const hasFailure = checks.some((check) => check.status === "failed");
    const hasWarning = checks.some((check) => check.status === "warning");
    const hasBlocked = checks.some((check) => check.status === "blocked");
    const status = hasFailure ? "failed" : hasWarning ? "failed" : "passed";
    const summary = status === "passed"
      ? hasBlocked ? "P22 质量检查通过；远端对象存储仍等待外部配置。" : "P22 质量检查全部通过。"
      : "P22 质量检查发现问题，请查看具体检查项。";
    const run = await this.prisma.operationalRun.create({
      data: {
        kind: "quality_check",
        status,
        summary,
        detail: { checks, blocked: hasBlocked } as unknown as Prisma.InputJsonValue,
        metrics: {
          total: checks.length,
          passed: checks.filter((check) => check.status === "passed").length,
          warnings: checks.filter((check) => check.status === "warning").length,
          blocked: checks.filter((check) => check.status === "blocked").length,
          failed: checks.filter((check) => check.status === "failed").length,
        } as unknown as Prisma.InputJsonValue,
        actorId,
        startedAt,
        completedAt: new Date(),
      },
    });
    return this.toRunResponse(run);
  }

  private pendingChecks(): QualityCheckResponse[] {
    return [
      this.check("database", "数据库连接", "Database connection", "检查 API 是否可以访问 MySQL。", "Checks whether the API can reach MySQL.", "待执行", "Not run yet", "warning"),
      this.check("redis", "Redis 连接", "Redis connection", "检查会话、限流和实时功能依赖的 Redis。", "Checks Redis used by sessions, rate limits, and realtime features.", "待执行", "Not run yet", "warning"),
      this.check("migrations", "迁移状态", "Migration state", "确认没有失败或未完成的 Prisma 迁移。", "Confirms there are no failed or unfinished Prisma migrations.", "待执行", "Not run yet", "warning"),
      this.check("storage", "媒体完整性", "Media integrity", "检查存储巡检是否存在待处理文件问题。", "Checks whether storage scans have unresolved file issues.", "待执行", "Not run yet", "warning"),
      this.check("remote-backup", "远端备份条件", "Remote backup prerequisites", "OSS/R2 没有配置时保留为阻塞，不影响本地质量检查。", "Unconfigured OSS/R2 remains blocked and does not fail local quality checks.", "待配置 OSS/R2", "OSS/R2 not configured", "blocked"),
    ];
  }

  private async checkDatabase(): Promise<QualityCheckResponse> {
    const startedAt = performance.now();
    try {
      await this.prisma.$queryRawUnsafe("SELECT 1");
      return this.check("database", "数据库连接", "Database connection", "检查 API 是否可以访问 MySQL。", "Checks whether the API can reach MySQL.", `连接正常，${this.elapsed(startedAt)} ms`, `Connected in ${this.elapsed(startedAt)} ms`, "passed");
    } catch {
      return this.check("database", "数据库连接", "Database connection", "检查 API 是否可以访问 MySQL。", "Checks whether the API can reach MySQL.", "连接失败", "Connection failed", "failed");
    }
  }

  private async checkRedis(): Promise<QualityCheckResponse> {
    const startedAt = performance.now();
    try {
      await this.redis.ping();
      return this.check("redis", "Redis 连接", "Redis connection", "检查会话、限流和实时功能依赖的 Redis。", "Checks Redis used by sessions, rate limits, and realtime features.", `连接正常，${this.elapsed(startedAt)} ms`, `Connected in ${this.elapsed(startedAt)} ms`, "passed");
    } catch {
      return this.check("redis", "Redis 连接", "Redis connection", "检查会话、限流和实时功能依赖的 Redis。", "Checks Redis used by sessions, rate limits, and realtime features.", "连接失败", "Connection failed", "failed");
    }
  }

  private async checkMigrations(): Promise<QualityCheckResponse> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number; failed: bigint | number }>>(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN finished_at IS NULL OR rolled_back_at IS NOT NULL THEN 1 ELSE 0 END) AS failed FROM _prisma_migrations",
      );
      const total = Number(rows[0]?.total ?? 0);
      const failed = Number(rows[0]?.failed ?? 0);
      return this.check("migrations", "迁移状态", "Migration state", "确认没有失败或未完成的 Prisma 迁移。", "Confirms there are no failed or unfinished Prisma migrations.", failed ? `${failed} 项未完成，共 ${total} 项` : `正常，共 ${total} 项`, failed ? `${failed} unfinished of ${total}` : `${total} migrations applied`, failed ? "failed" : "passed");
    } catch {
      return this.check("migrations", "迁移状态", "Migration state", "确认没有失败或未完成的 Prisma 迁移。", "Confirms there are no failed or unfinished Prisma migrations.", "无法读取迁移表", "Migration table unavailable", "failed");
    }
  }

  private async checkStorage(): Promise<QualityCheckResponse> {
    try {
      const overview = await this.storage.getOverview();
      const issueCount = overview.openIssues.total;
      return this.check("storage", "媒体完整性", "Media integrity", "检查存储巡检是否存在待处理文件问题。", "Checks whether storage scans have unresolved file issues.", issueCount ? `${issueCount} 项待处理` : "没有待处理问题", issueCount ? `${issueCount} unresolved issue(s)` : "No unresolved issues", issueCount ? "warning" : "passed");
    } catch {
      return this.check("storage", "媒体完整性", "Media integrity", "检查存储巡检是否存在待处理文件问题。", "Checks whether storage scans have unresolved file issues.", "巡检状态无法读取", "Storage overview unavailable", "failed");
    }
  }

  private async checkBackupConfiguration(): Promise<QualityCheckResponse> {
    try {
      const configuration = await this.backups.getConfiguration();
      const remoteConfigured = (configuration.oss.enabled && configuration.oss.hasAccessKeyId && configuration.oss.hasSecretAccessKey)
        || (configuration.r2.enabled && configuration.r2.hasAccessKeyId && configuration.r2.hasSecretAccessKey);
      return this.check("remote-backup", "远端备份条件", "Remote backup prerequisites", "OSS/R2 没有配置时保留为阻塞，不影响本地质量检查。", "Unconfigured OSS/R2 remains blocked and does not fail local quality checks.", remoteConfigured ? "已配置远端提供商" : "待配置 OSS/R2", remoteConfigured ? "Remote provider configured" : "OSS/R2 not configured", remoteConfigured ? "passed" : "blocked");
    } catch {
      return this.check("remote-backup", "远端备份条件", "Remote backup prerequisites", "OSS/R2 没有配置时保留为阻塞，不影响本地质量检查。", "Unconfigured OSS/R2 remains blocked and does not fail local quality checks.", "配置无法读取", "Configuration unavailable", "failed");
    }
  }

  private check(id: string, label: string, labelEn: string, description: string, descriptionEn: string, detail: string, detailEn: string, status: QualityCheckStatus): QualityCheckResponse {
    return { id, label, labelEn, description, descriptionEn, detail, detailEn, status };
  }

  private readChecks(value: unknown): QualityCheckResponse[] {
    if (!Array.isArray(value)) return this.pendingChecks();
    return value.filter((item): item is QualityCheckResponse => Boolean(item && typeof item === "object" && "id" in item && "status" in item)) as QualityCheckResponse[];
  }

  private elapsed(startedAt: number): string {
    return (Math.round((performance.now() - startedAt) * 10) / 10).toFixed(1);
  }

  private toRunResponse(item: { id: number; kind: string; status: string; provider: string | null; summary: string; detail: Prisma.JsonValue | null; metrics: Prisma.JsonValue | null; actorId: number | null; startedAt: Date; completedAt: Date | null; createdAt: Date }): OperationalRunResponse {
    return { id: item.id, kind: item.kind, status: item.status, provider: item.provider, summary: item.summary, detail: item.detail, metrics: item.metrics, actorId: item.actorId, startedAt: item.startedAt.toISOString(), completedAt: item.completedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString() };
  }
}
