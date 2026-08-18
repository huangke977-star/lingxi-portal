import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable, tap } from "rxjs";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";

type AuditScope = "business" | "security" | "server";
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface AuditRequest extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest<AuditRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const descriptor = this.describe(request);
    if (!descriptor || !request.user || (!request.user.isSuperAdmin && !request.user.isAdministrator)) {
      return next.handle();
    }
    const startedAt = Date.now();
    return next.handle().pipe(tap({
      next: () => void this.write(request, descriptor, response.statusCode, Date.now() - startedAt),
      error: (error: unknown) => void this.write(
        request,
        descriptor,
        error instanceof HttpException ? error.getStatus() : 500,
        Date.now() - startedAt,
      ),
    }));
  }

  private async write(
    request: AuditRequest,
    descriptor: { action: string; scope: AuditScope; targetType: string | null; summary: string },
    statusCode: number,
    durationMs: number,
  ): Promise<void> {
    const model = (this.prisma as unknown as {
      auditLog?: { create: (args: unknown) => Promise<unknown> };
    }).auditLog;
    if (!model || !request.user) return;
    const forwardedFor = request.headers["x-forwarded-for"];
    const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0])
      ?? request.ip
      ?? "";
    const targetId = this.targetId(request);
    try {
      await model.create({ data: {
        actorId: request.user.id,
        actorUsername: request.user.username,
        actorNickname: request.user.nickname || request.user.username,
        action: descriptor.action,
        scope: descriptor.scope,
        method: request.method.toUpperCase(),
        path: request.path.slice(0, 512),
        targetType: descriptor.targetType,
        targetId,
        summary: descriptor.summary,
        metadata: this.sanitize({ params: request.params, query: request.query, body: request.body }),
        ip: ip.trim().slice(0, 80),
        userAgent: String(request.headers["user-agent"] ?? "").slice(0, 500),
        statusCode,
        durationMs: Math.max(0, Math.round(durationMs)),
      } });
    } catch {
      // Audit persistence must never make the original administration action fail.
    }
  }

  private describe(request: AuditRequest): {
    action: string;
    scope: AuditScope;
    targetType: string | null;
    summary: string;
  } | null {
    const method = request.method.toUpperCase();
    const path = request.path;
    const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(method);
    if (path.startsWith("/admin/system")) {
      if (!isMutation && !/\/backups\/[^/]+\/download$/.test(path)) return null;
      return this.entry(method, path, "server", "database_backup", "数据库备份操作");
    }
    if (!isMutation) return null;
    if (path.startsWith("/users")) return this.entry(method, path, "business", "user", "用户账号管理");
    if (path.startsWith("/portal/admin")) return this.entry(method, path, "business", "portal_content", "门户内容管理");
    if (path.startsWith("/articles/admin")) return this.entry(method, path, "business", "article_content", "文章与评论管理");
    if (path.startsWith("/announcements/admin")) return this.entry(method, path, "business", "announcement", "运营公告管理");
    if (path.startsWith("/analytics/admin")) return this.entry(method, path, "business", "operation_analytics", "运营数据聚合");
    if (path.startsWith("/social/group-reports")) return this.entry(method, path, "business", "group_report", "群聊举报管理");
    if (path.startsWith("/admin/cache")) return this.entry(method, path, "security", "redis_cache", "Redis 缓存管理");
    if (path.startsWith("/site-settings")) return this.entry(method, path, "security", "site_setting", "站点设置管理");
    if (path.startsWith("/security-admin")) return this.entry(method, path, "security", "account_security", "账号安全管理");
    if (path.startsWith("/backgrounds")) return this.entry(method, path, "security", "background", "站点背景管理");
    if (path.startsWith("/android-releases")) return this.entry(method, path, "security", "android_release", "安装包管理");
    return null;
  }

  private entry(method: string, path: string, scope: AuditScope, targetType: string, summary: string) {
    const operation = method === "POST" ? "create" : method === "PATCH" || method === "PUT" ? "update" : method === "DELETE" ? "delete" : "download";
    return {
      action: `${targetType}.${operation}`,
      scope,
      targetType,
      summary: `${summary} · ${operation === "create" ? "新增/执行" : operation === "update" ? "修改" : operation === "delete" ? "删除" : "下载"}`,
      path,
    };
  }

  private targetId(request: AuditRequest): string | null {
    const value = request.params?.id ?? request.params?.name ?? request.body?.id ?? null;
    if (value === null || value === undefined) return null;
    return String(value).slice(0, 120);
  }

  private sanitize(value: unknown, depth = 0): JsonValue {
    if (depth > 4) return "[TRUNCATED]";
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value.slice(0, 500);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => this.sanitize(item, depth + 1));
    if (typeof value !== "object") return String(value).slice(0, 500);
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      result[key] = /(password|passwd|secret|token|authorization|cookie|api[-_]?key|access[-_]?key|private[-_]?key|credential)/i.test(key)
        ? "[REDACTED]"
        : this.sanitize(item, depth + 1);
    }
    return result;
  }
}
