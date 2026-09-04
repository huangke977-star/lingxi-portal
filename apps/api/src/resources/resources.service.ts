import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, ReputationReason, ResourceDeliveryEventType, ResourceDeliveryStatus } from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { ReputationService } from "../reputation/reputation.service";
import { ResourceAdjustmentDto, ResourceFailureDto } from "./dto/resource.dto";

type DeliveryItem = {
  id: number;
  articleId: number;
  blockKey: string;
  pointCost: number;
  deliveryStatus: ResourceDeliveryStatus;
  attemptCount: number;
  lastError: string | null;
  downloadedAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
  sellerAvailableAt: Date;
  sellerSettledAt: Date | null;
  article: { id: number; title: string; slug: string };
  buyer: { id: number; nickname: string; username: string };
  author: { id: number; nickname: string; username: string };
  deliveryEvents: Array<{ id: number; type: ResourceDeliveryEventType; attempt: number; detail: string | null; createdAt: Date }>;
};

@Injectable()
export class ResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reputationService: ReputationService,
  ) {}

  async listMine(user: AuthenticatedUser, page = 1, pageSize = 20) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(50, Math.max(1, Math.floor(pageSize)));
    const where = { buyerId: user.id };
    const [total, items] = await Promise.all([
      this.prisma.articleResourceExchange.count({ where }),
      this.prisma.articleResourceExchange.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        include: this.deliveryInclude(),
      }),
    ]);
    return { items: items.map((item) => this.toDelivery(item as unknown as DeliveryItem)), total, page: safePage, pageSize: safePageSize, totalPages: Math.max(1, Math.ceil(total / safePageSize)) };
  }

  async listAdmin(page = 1, pageSize = 50) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const [total, items] = await Promise.all([
      this.prisma.articleResourceExchange.count(),
      this.prisma.articleResourceExchange.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (safePage - 1) * safePageSize, take: safePageSize, include: this.deliveryInclude() }),
    ]);
    return { items: items.map((item) => this.toDelivery(item as unknown as DeliveryItem)), total, page: safePage, pageSize: safePageSize, totalPages: Math.max(1, Math.ceil(total / safePageSize)) };
  }

  async listAdminPointAdjustments(page = 1, pageSize = 50) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where: Prisma.UserReputationLedgerWhereInput = {
      reason: { in: [ReputationReason.points_top_up, ReputationReason.violation_penalty] },
    };
    const [total, items] = await Promise.all([
      this.prisma.userReputationLedger.count({ where }),
      this.prisma.userReputationLedger.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        include: { user: { select: { id: true, nickname: true, username: true } } },
      }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        user: item.user,
        reason: item.reason,
        eventKey: item.eventKey,
        description: item.description,
        pointDelta: item.pointDelta,
        pointsAfter: item.pointsAfter,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    };
  }

  async creatorEarnings(user: AuthenticatedUser) {
    await this.reputationService.settlePendingPoints();
    const items = await this.prisma.articleResourceExchange.findMany({
      where: { authorId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: this.deliveryInclude(),
    });
    const summary = items.reduce((result, item) => {
      result.total += item.pointCost;
      if (item.deliveryStatus === ResourceDeliveryStatus.refunded) result.refunded += item.pointCost;
      else if (item.sellerSettledAt) result.settled += item.pointCost;
      else result.pending += item.pointCost;
      return result;
    }, { total: 0, pending: 0, settled: 0, refunded: 0 });
    const aggregates = new Map<string, {
      articleId: number;
      article: { id: number; title: string; slug: string };
      blockKey: string;
      redemptionCount: number;
      grossPoints: number;
      pendingPoints: number;
      settledPoints: number;
      refundedPoints: number;
    }>();
    for (const item of items) {
      const delivery = item as unknown as DeliveryItem;
      const key = `${delivery.articleId}:${delivery.blockKey}`;
      const aggregate = aggregates.get(key) ?? {
        articleId: delivery.articleId,
        article: delivery.article,
        blockKey: delivery.blockKey,
        redemptionCount: 0,
        grossPoints: 0,
        pendingPoints: 0,
        settledPoints: 0,
        refundedPoints: 0,
      };
      aggregate.redemptionCount += 1;
      aggregate.grossPoints += delivery.pointCost;
      if (delivery.deliveryStatus === ResourceDeliveryStatus.refunded) aggregate.refundedPoints += delivery.pointCost;
      else if (delivery.sellerSettledAt) aggregate.settledPoints += delivery.pointCost;
      else aggregate.pendingPoints += delivery.pointCost;
      aggregates.set(key, aggregate);
    }
    return {
      summary,
      aggregates: [...aggregates.values()],
      items: items.slice(0, 100).map((item) => this.toDelivery(item as unknown as DeliveryItem)),
    };
  }

  async download(id: number, user: AuthenticatedUser) {
    const exchange = await this.prisma.articleResourceExchange.findFirst({ where: { id, buyerId: user.id } });
    if (!exchange) throw new NotFoundException("兑换记录不存在。");
    if (exchange.deliveryStatus === ResourceDeliveryStatus.refunded) throw new BadRequestException("该资源已退款，不能继续下载。");
    if (exchange.deliveryStatus === ResourceDeliveryStatus.failed) throw new BadRequestException("资源交付失败，请先重试。");
    if (exchange.deliveryStatus !== ResourceDeliveryStatus.downloaded) {
      const now = new Date();
      await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.articleResourceExchange.updateMany({ where: { id, buyerId: user.id, deliveryStatus: { not: ResourceDeliveryStatus.refunded } }, data: { deliveryStatus: ResourceDeliveryStatus.downloaded, downloadedAt: now, lastError: null } });
        if (updated.count) await this.recordEvent(transaction, id, ResourceDeliveryEventType.downloaded, exchange.attemptCount, "资源下载成功");
      });
    }
    return { id, status: ResourceDeliveryStatus.downloaded, articleId: exchange.articleId, blockKey: exchange.blockKey };
  }

  async retry(id: number, user: AuthenticatedUser) {
    const exchange = await this.prisma.articleResourceExchange.findFirst({ where: { id, buyerId: user.id } });
    if (!exchange) throw new NotFoundException("兑换记录不存在。");
    if (exchange.deliveryStatus !== ResourceDeliveryStatus.failed) return { id, status: exchange.deliveryStatus };
    const attempt = exchange.attemptCount + 1;
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.articleResourceExchange.updateMany({ where: { id, buyerId: user.id, deliveryStatus: ResourceDeliveryStatus.failed }, data: { deliveryStatus: ResourceDeliveryStatus.unlocked, attemptCount: { increment: 1 }, lastError: null } });
      if (!updated.count) return;
      await this.recordEvent(transaction, id, ResourceDeliveryEventType.retry, attempt, "用户重试资源交付");
      await this.recordEvent(transaction, id, ResourceDeliveryEventType.unlocked, attempt, "资源重新解锁");
    });
    return { id, status: ResourceDeliveryStatus.unlocked, attemptCount: attempt };
  }

  async markFailed(id: number, dto: ResourceFailureDto) {
    const exchange = await this.prisma.articleResourceExchange.findUnique({ where: { id } });
    if (!exchange) throw new NotFoundException("兑换记录不存在。");
    if (exchange.deliveryStatus === ResourceDeliveryStatus.refunded) throw new BadRequestException("已退款记录不能标记失败。");
    const attempt = exchange.attemptCount + 1;
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.articleResourceExchange.updateMany({ where: { id, deliveryStatus: { not: ResourceDeliveryStatus.refunded } }, data: { deliveryStatus: ResourceDeliveryStatus.failed, attemptCount: { increment: 1 }, lastError: dto.error?.trim().slice(0, 1000) || "资源交付失败" } });
      if (updated.count) await this.recordEvent(transaction, id, ResourceDeliveryEventType.failed, attempt, dto.error?.trim().slice(0, 1000) || "资源交付失败");
    });
    return { id, status: ResourceDeliveryStatus.failed, attemptCount: attempt };
  }

  async refund(id: number) {
    const exchange = await this.prisma.articleResourceExchange.findUnique({ where: { id } });
    if (!exchange) throw new NotFoundException("兑换记录不存在。");
    if (exchange.deliveryStatus === ResourceDeliveryStatus.refunded) return { id, status: ResourceDeliveryStatus.refunded, idempotent: true };
    await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.articleResourceExchange.updateMany({ where: { id, deliveryStatus: { not: ResourceDeliveryStatus.refunded } }, data: { deliveryStatus: ResourceDeliveryStatus.refunded, refundedAt: new Date() } });
      if (!claimed.count) return;
      if (!exchange.sellerSettledAt) {
        await transaction.userReputationLedger.updateMany({ where: { userId: exchange.authorId, eventKey: `resource-sold:${exchange.articleId}:${exchange.buyerId}:${exchange.blockKey}`, settledAt: null }, data: { pendingPointDelta: 0, settledAt: new Date(), description: "文章资源兑换已退款" } });
      } else {
        await this.reputationService.recordManualAdjustment(transaction, { userId: exchange.authorId, reason: ReputationReason.resource_refund, points: -exchange.pointCost, eventKey: `resource-refund-author:${id}`, description: "文章资源退款扣回", metadata: { exchangeId: id } });
      }
      await this.reputationService.recordManualAdjustment(transaction, { userId: exchange.buyerId, reason: ReputationReason.resource_refund, points: exchange.pointCost, eventKey: `resource-refund-buyer:${id}`, description: "文章资源退款", metadata: { exchangeId: id } });
      await this.recordEvent(transaction, id, ResourceDeliveryEventType.refunded, exchange.attemptCount, "管理员退款");
    });
    return { id, status: ResourceDeliveryStatus.refunded, idempotent: false };
  }

  async topUp(dto: ResourceAdjustmentDto) {
    const targetUserId = await this.resolveAdjustmentUserId(dto.username);
    const applied = await this.prisma.$transaction((transaction) => this.reputationService.recordManualAdjustment(transaction, { userId: targetUserId, reason: ReputationReason.points_top_up, points: dto.points, eventKey: `points-top-up:${targetUserId}:${dto.eventKey.trim()}`, description: dto.note?.trim() || "管理员积分补发", metadata: { source: "admin", eventKey: dto.eventKey.trim(), username: dto.username.trim().replace(/^@+/, "") } }));
    return { applied };
  }

  async violation(dto: ResourceAdjustmentDto) {
    const targetUserId = await this.resolveAdjustmentUserId(dto.username);
    const applied = await this.prisma.$transaction((transaction) => this.reputationService.recordManualAdjustment(transaction, { userId: targetUserId, reason: ReputationReason.violation_penalty, points: -dto.points, eventKey: `violation-penalty:${targetUserId}:${dto.eventKey.trim()}`, description: dto.note?.trim() || "违规处理扣除积分", metadata: { source: "admin", eventKey: dto.eventKey.trim(), username: dto.username.trim().replace(/^@+/, "") } }));
    return { applied };
  }

  private async resolveAdjustmentUserId(rawUsername: string): Promise<number> {
    const username = rawUsername.trim().replace(/^@+/, "");
    if (!username) throw new BadRequestException("请输入用户名。");
    const target = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!target) throw new NotFoundException("用户不存在。");
    return target.id;
  }

  private deliveryInclude() {
    return {
      article: { select: { id: true, title: true, slug: true } },
      buyer: { select: { id: true, nickname: true, username: true } },
      author: { select: { id: true, nickname: true, username: true } },
      deliveryEvents: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 20 },
    } satisfies Prisma.ArticleResourceExchangeInclude;
  }

  private toDelivery(item: DeliveryItem) {
    return {
      id: item.id,
      articleId: item.articleId,
      article: item.article,
      blockKey: item.blockKey,
      pointCost: item.pointCost,
      status: item.deliveryStatus,
      attemptCount: item.attemptCount,
      lastError: item.lastError,
      downloadedAt: item.downloadedAt?.toISOString() ?? null,
      refundedAt: item.refundedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      availableAt: item.sellerAvailableAt.toISOString(),
      settledAt: item.sellerSettledAt?.toISOString() ?? null,
      buyer: item.buyer,
      author: item.author,
      events: item.deliveryEvents.map((event) => ({ id: event.id, type: event.type, attempt: event.attempt, detail: event.detail, createdAt: event.createdAt.toISOString() })),
    };
  }

  private async recordEvent(transaction: Prisma.TransactionClient, exchangeId: number, type: ResourceDeliveryEventType, attempt: number, detail: string) {
    const delegate = (transaction as unknown as { articleResourceDeliveryEvent?: { create: (args: unknown) => Promise<unknown> } }).articleResourceDeliveryEvent;
    if (!delegate) return;
    await delegate.create({ data: { exchangeId, type, attempt, detail: detail.slice(0, 1000), eventKey: `resource-delivery:${exchangeId}:${type}:${attempt}:${randomUUID()}` } });
  }
}
