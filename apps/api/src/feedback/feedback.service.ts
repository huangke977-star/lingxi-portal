import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, UserFeedbackStatus, UserNotificationChannel, UserNotificationType } from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { CreateFeedbackDto, ListFeedbackQueryDto, ReplyFeedbackDto, UpdateFeedbackStatusDto } from "./dto/feedback.dto";

const feedbackInclude = {
  user: { select: { id: true, username: true, nickname: true, avatarStoredName: true } },
  reviewedBy: { select: { id: true, username: true, nickname: true, avatarStoredName: true } },
  replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, username: true, nickname: true, avatarStoredName: true } } } },
} satisfies Prisma.UserFeedbackInclude;

type FeedbackRecord = Prisma.UserFeedbackGetPayload<{ include: typeof feedbackInclude }>;

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  listMine(user: AuthenticatedUser, query: ListFeedbackQueryDto) {
    return this.list(query, { userId: user.id });
  }

  listInbox(user: AuthenticatedUser, query: ListFeedbackQueryDto) {
    this.assertManager(user);
    return this.list(query, {});
  }

  async get(user: AuthenticatedUser, id: number) {
    const item = await this.getOrThrow(id);
    if (item.userId !== user.id) this.assertManager(user);
    return this.toDetail(item);
  }

  async create(user: AuthenticatedUser, dto: CreateFeedbackDto) {
    const title = dto.title.trim();
    const content = dto.content.trim();
    if (!title || !content) throw new BadRequestException("请填写反馈标题和内容。");
    const latest = await this.prisma.userFeedback.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (latest && Date.now() - latest.createdAt.getTime() < 60_000) throw new BadRequestException("请稍后再提交下一条反馈。");
    return this.toDetail(await this.prisma.userFeedback.create({ data: { userId: user.id, category: dto.category, title, content }, include: feedbackInclude }));
  }

  async updateStatus(user: AuthenticatedUser, id: number, dto: UpdateFeedbackStatusDto) {
    this.assertManager(user);
    const item = await this.getOrThrow(id);
    const updated = await this.prisma.userFeedback.update({ where: { id }, data: { status: dto.status as UserFeedbackStatus, reviewedById: user.id, reviewedAt: new Date() }, include: feedbackInclude });
    await this.notifyUser(item.userId, user.id, updated.title, `反馈状态已更新为${this.statusLabel(updated.status)}。`);
    return this.toDetail(updated);
  }

  async reply(user: AuthenticatedUser, id: number, dto: ReplyFeedbackDto) {
    const item = await this.getOrThrow(id);
    const content = dto.content.trim();
    if (!content) throw new BadRequestException("回复内容不能为空。");
    const manager = this.isManager(user);
    if (!manager && item.userId !== user.id) throw new ForbiddenException("无权回复这条反馈。");
    const created = await this.prisma.$transaction(async (transaction) => {
      await transaction.userFeedbackReply.create({ data: { feedbackId: id, authorId: user.id, content } });
      return transaction.userFeedback.update({ where: { id }, data: manager ? { reviewedById: user.id, reviewedAt: new Date() } : {}, include: feedbackInclude });
    });
    if (manager) await this.notifyUser(item.userId, user.id, item.title, "管理员回复了你的反馈。");
    return this.toDetail(created);
  }

  private async list(query: ListFeedbackQueryDto, where: Prisma.UserFeedbackWhereInput) {
    const keyword = query.q?.trim();
    const finalWhere: Prisma.UserFeedbackWhereInput = {
      AND: [where, query.status ? { status: query.status as UserFeedbackStatus } : {}, keyword ? { OR: [{ title: { contains: keyword } }, { content: { contains: keyword } }] } : {}],
    };
    const [total, items] = await Promise.all([
      this.prisma.userFeedback.count({ where: finalWhere }),
      this.prisma.userFeedback.findMany({ where: finalWhere, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: feedbackInclude }),
    ]);
    return { items: items.map((item) => this.toSummary(item)), total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  private async getOrThrow(id: number): Promise<FeedbackRecord> {
    const item = await this.prisma.userFeedback.findUnique({ where: { id }, include: feedbackInclude });
    if (!item) throw new NotFoundException("反馈不存在。");
    return item;
  }

  private async notifyUser(userId: number, actorId: number, title: string, body: string) {
    await this.prisma.userNotification.create({ data: { userId, actorId, type: UserNotificationType.feedback_updated, channel: UserNotificationChannel.interaction, title: "反馈处理通知", body: `${title}：${body}`.slice(0, 500), actionUrl: "/feedback" } });
  }

  private toUser(user: { id: number; username: string; nickname: string; avatarStoredName: string | null }) {
    return { id: user.id, username: user.username, nickname: user.nickname || user.username, avatarUrl: user.avatarStoredName ? `/auth/avatars/${user.avatarStoredName}` : null };
  }

  private toSummary(item: FeedbackRecord) {
    return { id: item.id, category: item.category, title: item.title, status: item.status, user: this.toUser(item.user), replyCount: item.replies.length, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
  }

  private toDetail(item: FeedbackRecord) {
    return { ...this.toSummary(item), content: item.content, reviewedAt: item.reviewedAt?.toISOString() ?? null, reviewedBy: item.reviewedBy ? this.toUser(item.reviewedBy) : null, replies: item.replies.map((reply) => ({ id: reply.id, content: reply.content, author: this.toUser(reply.author), createdAt: reply.createdAt.toISOString() })) };
  }

  private isManager(user: AuthenticatedUser) { return user.isSuperAdmin || user.role.level >= 90; }

  private assertManager(user: AuthenticatedUser) { if (!this.isManager(user)) throw new ForbiddenException("需要管理员权限。"); }

  private statusLabel(status: UserFeedbackStatus) { return ({ pending: "待处理", in_progress: "处理中", resolved: "已解决", closed: "已关闭" } as Record<UserFeedbackStatus, string>)[status]; }
}
