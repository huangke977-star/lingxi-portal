import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SuggestionStatus, UserNotificationChannel, UserNotificationType } from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSuggestionDto, ListSuggestionsQueryDto, ReplySuggestionDto, ReviewSuggestionDto } from "./dto/suggestion.dto";

const suggestionInclude = {
  user: { select: { id: true, username: true, nickname: true } },
  reviewedBy: { select: { id: true, username: true, nickname: true } },
  replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, username: true, nickname: true } } } },
} satisfies Prisma.SiteSuggestionInclude;

type SuggestionRecord = Prisma.SiteSuggestionGetPayload<{ include: typeof suggestionInclude }>;

@Injectable()
export class SuggestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(query: ListSuggestionsQueryDto) {
    return this.list(query, {});
  }

  async listMine(user: AuthenticatedUser, query: ListSuggestionsQueryDto) {
    return this.list(query, { userId: user.id });
  }

  async listInbox(user: AuthenticatedUser, query: ListSuggestionsQueryDto) {
    this.assertSuperAdmin(user);
    return this.list(query, {});
  }

  async getPublic(id: number) {
    return this.toDetail(await this.getOrThrow(id));
  }

  async create(user: AuthenticatedUser, dto: CreateSuggestionDto) {
    const title = dto.title.trim();
    const content = dto.content.trim();
    if (!title || !content) throw new BadRequestException("请填写建议标题和具体内容。");
    const latest = await this.prisma.siteSuggestion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < 60_000) {
      throw new BadRequestException("请稍后再提交下一条建议。");
    }
    return this.toDetail(await this.prisma.siteSuggestion.create({
      data: { userId: user.id, title, content },
      include: suggestionInclude,
    }));
  }

  async review(user: AuthenticatedUser, id: number, dto: ReviewSuggestionDto) {
    this.assertSuperAdmin(user);
    await this.getOrThrow(id);
    const status = dto.status as SuggestionStatus;
    const updated = await this.prisma.siteSuggestion.update({
      where: { id },
      data: { status, reviewedById: user.id, reviewedAt: new Date() },
      include: suggestionInclude,
    });
    await this.notifySubmitter(updated, user.id, `建议进度已更新为${this.statusLabel(status)}。`);
    return this.toDetail(updated);
  }

  async reply(user: AuthenticatedUser, id: number, dto: ReplySuggestionDto) {
    this.assertSuperAdmin(user);
    const content = dto.content.trim();
    if (!content) throw new BadRequestException("回复内容不能为空。");
    const suggestion = await this.getOrThrow(id);
    await this.prisma.$transaction([
      this.prisma.siteSuggestionReply.create({ data: { suggestionId: id, authorId: user.id, content } }),
      this.prisma.siteSuggestion.update({ where: { id }, data: { reviewedById: user.id, reviewedAt: new Date() } }),
    ]);
    await this.notifySubmitter(suggestion, user.id, "超级管理员回复了你的建议。");
    return this.toDetail(await this.getOrThrow(id));
  }

  private async list(query: ListSuggestionsQueryDto, where: Prisma.SiteSuggestionWhereInput) {
    const keyword = query.q?.trim();
    const searchWhere: Prisma.SiteSuggestionWhereInput = keyword
      ? { OR: [{ title: { contains: keyword } }, { content: { contains: keyword } }] }
      : {};
    const finalWhere: Prisma.SiteSuggestionWhereInput = {
      AND: [where, searchWhere],
    };
    const [total, items] = await Promise.all([
      this.prisma.siteSuggestion.count({ where: finalWhere }),
      this.prisma.siteSuggestion.findMany({
        where: finalWhere,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: suggestionInclude,
      }),
    ]);
    return {
      items: items.map((item) => this.toSummary(item)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  private async getOrThrow(id: number): Promise<SuggestionRecord> {
    const suggestion = await this.prisma.siteSuggestion.findUnique({ where: { id }, include: suggestionInclude });
    if (!suggestion) throw new NotFoundException("建议不存在或已删除。");
    return suggestion;
  }

  private async notifySubmitter(suggestion: SuggestionRecord, actorId: number, body: string): Promise<void> {
    await this.prisma.userNotification.create({
      data: {
        userId: suggestion.userId,
        actorId,
        type: UserNotificationType.suggestion_updated,
        channel: UserNotificationChannel.interaction,
        title: "建议处理通知",
        body: `${suggestion.title}：${body}`,
        actionUrl: "/dashboard",
      },
    });
  }

  private toSummary(item: SuggestionRecord) {
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      user: this.toUser(item.user),
      reviewedBy: item.reviewedBy ? this.toUser(item.reviewedBy) : null,
      replyCount: item.replies.length,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toDetail(item: SuggestionRecord) {
    return {
      ...this.toSummary(item),
      content: item.content,
      reviewedAt: item.reviewedAt?.toISOString() ?? null,
      replies: item.replies.map((reply) => ({
        id: reply.id,
        content: reply.content,
        author: this.toUser(reply.author),
        createdAt: reply.createdAt.toISOString(),
      })),
    };
  }

  private toUser(user: { id: number; username: string; nickname: string }) {
    return { id: user.id, username: user.username, nickname: user.nickname || user.username };
  }

  private statusLabel(status: SuggestionStatus): string {
    return ({ pending: "待评估", scheduled: "已排期", in_progress: "进行中", completed: "已完成", rejected: "已驳回" } as Record<SuggestionStatus, string>)[status];
  }

  private assertSuperAdmin(user: AuthenticatedUser): void {
    if (!user.isSuperAdmin) throw new ForbiddenException("仅超级管理员可以处理建议。");
  }
}
