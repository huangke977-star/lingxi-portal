import { Injectable } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { Prisma, type AuditLog } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ListAuditLogsQueryDto } from "./dto/audit.dto";
import { AuditLogPageResponse, AuditLogResponse } from "./audit.types";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAuditLogsQueryDto, viewer: AuthenticatedUser): Promise<AuditLogPageResponse> {
    const search = query.search?.trim();
    const where: Prisma.AuditLogWhereInput = {
      scope: viewer.isSuperAdmin ? query.scope : "business",
      ...(query.result === "success" ? { statusCode: { lt: 400 } } : {}),
      ...(query.result === "failed" ? { statusCode: { gte: 400 } } : {}),
      ...(search ? {
        OR: [
          { actorUsername: { contains: search } },
          { actorNickname: { contains: search } },
          { action: { contains: search } },
          { path: { contains: search } },
          { summary: { contains: search } },
          { targetId: { contains: search } },
        ],
      } : {}),
    };
    const total = await this.prisma.auditLog.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const items = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return {
      items: items.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  private toResponse(log: AuditLog): AuditLogResponse {
    return {
      id: log.id,
      actor: {
        id: log.actorId,
        username: log.actorUsername,
        nickname: log.actorNickname,
      },
      action: log.action,
      scope: log.scope as AuditLogResponse["scope"],
      method: log.method,
      path: log.path,
      targetType: log.targetType,
      targetId: log.targetId,
      summary: log.summary,
      metadata: log.metadata,
      ip: log.ip,
      userAgent: log.userAgent,
      statusCode: log.statusCode,
      durationMs: log.durationMs,
      createdAt: log.createdAt.toISOString(),
    };
  }
}
