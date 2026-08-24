import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  ArticleCommentReportStatus,
  ChatGroupReportStatus,
  ModerationContentSource,
  ModerationDeadlineStage,
  ModerationRuleAction,
  ModerationRuleType,
  Prisma,
  UserNotificationChannel,
  UserNotificationType,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateModerationRuleDto,
  CreateModerationTemplateDto,
  ListModerationReportsQueryDto,
  ListModerationRuleHitsQueryDto,
  ModerationReportSource,
  UpdateModerationRuleDto,
  UpdateModerationSettingsDto,
  UpdateModerationTemplateDto,
} from "./dto/moderation.dto";
import type {
  ModerationOverviewResponse,
  ModerationReportPageResponse,
  ModerationReportResponse,
  ModerationReportSummaryResponse,
  ModerationRuleHitResponse,
  ModerationRuleResponse,
  ModerationSettingsResponse,
  ModerationTemplateResponse,
  ModerationUserResponse,
} from "./moderation.types";

const userSelect = {
  id: true,
  nickname: true,
  username: true,
  avatarStoredName: true,
  isSuperAdmin: true,
  isAdministrator: true,
  role: { select: { code: true, name: true, level: true } },
} satisfies Prisma.UserSelect;

const commentReportSelect = {
  id: true,
  reason: true,
  detail: true,
  status: true,
  resolution: true,
  handledAt: true,
  createdAt: true,
  reporter: { select: userSelect },
  comment: {
    select: {
      id: true,
      body: true,
      status: true,
      author: { select: userSelect },
      article: {
        select: {
          id: true,
          title: true,
          slug: true,
          author: { select: userSelect },
        },
      },
    },
  },
} satisfies Prisma.ArticleCommentReportSelect;

const articleReportSelect = {
  id: true,
  reason: true,
  detail: true,
  status: true,
  resolution: true,
  handledAt: true,
  createdAt: true,
  reporter: { select: userSelect },
  article: {
    select: {
      id: true,
      title: true,
      slug: true,
      author: { select: userSelect },
    },
  },
} satisfies Prisma.ArticleReportSelect;

const groupReportSelect = {
  id: true,
  reason: true,
  detail: true,
  status: true,
  resolution: true,
  handledAt: true,
  createdAt: true,
  reporter: { select: userSelect },
  group: {
    select: {
      id: true,
      conversationId: true,
      name: true,
      avatarUrl: true,
      avatarStoredName: true,
    },
  },
  message: {
    select: {
      id: true,
      body: true,
      type: true,
      createdAt: true,
      sender: { select: userSelect },
      attachments: {
        select: { id: true, conversationId: true, kind: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  },
} satisfies Prisma.ChatGroupMessageReportSelect;

type CommentReportRecord = Prisma.ArticleCommentReportGetPayload<{ select: typeof commentReportSelect }>;
type ArticleReportRecord = Prisma.ArticleReportGetPayload<{ select: typeof articleReportSelect }>;
type GroupReportRecord = Prisma.ChatGroupMessageReportGetPayload<{ select: typeof groupReportSelect }>;

@Injectable()
export class ModerationService implements OnModuleInit, OnModuleDestroy {
  private deadlineTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.deadlineTimer = setInterval(() => void this.runDeadlineNotifications().catch(() => undefined), 5 * 60 * 1_000);
    this.deadlineTimer.unref();
    setTimeout(() => void this.runDeadlineNotifications().catch(() => undefined), 25_000).unref();
  }

  onModuleDestroy(): void {
    if (this.deadlineTimer) clearInterval(this.deadlineTimer);
  }

  async listReports(query: ListModerationReportsQueryDto): Promise<ModerationReportPageResponse> {
    const status = query.status === "all" ? undefined : query.status;
    const take = query.page * query.pageSize;
    const [comments, articles, groups, commentCount, articleCount, groupCount] = await Promise.all([
      this.fetchComments(query.type, status, take),
      this.fetchArticles(query.type, status, take),
      this.fetchGroups(query.type, status, take),
      this.countComments(query.type, status),
      this.countArticles(query.type, status),
      this.countGroups(query.type, status),
    ]);
    const items = [...comments, ...articles, ...groups]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id - left.id)
      .slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    const total = commentCount + articleCount + groupCount;
    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async getSummary(): Promise<ModerationReportSummaryResponse> {
    const [commentPending, articlePending, groupPending, commentTotal, articleTotal, groupTotal] = await Promise.all([
      this.countComments("comment", "pending"),
      this.countArticles("article", "pending"),
      this.countGroups("group_message", "pending"),
      this.countComments("comment"),
      this.countArticles("article"),
      this.countGroups("group_message"),
    ]);
    return {
      total: commentTotal + articleTotal + groupTotal,
      pending: commentPending + articlePending + groupPending,
      bySource: {
        comment: commentPending,
        article: articlePending,
        group_message: groupPending,
      },
    };
  }

  async listRules(): Promise<{ items: ModerationRuleResponse[] }> {
    const items = await this.prisma.moderationRule.findMany({ orderBy: [{ type: "asc" }, { id: "asc" }] });
    return { items: items.map((item) => this.toRule(item)) };
  }

  async createRule(user: AuthenticatedUser, dto: CreateModerationRuleDto): Promise<ModerationRuleResponse> {
    this.assertSuperAdmin(user);
    this.ruleData(dto);
    const item = await this.prisma.moderationRule.create({
      data: {
        name: dto.name.trim(),
        type: dto.type as ModerationRuleType,
        action: (dto.action ?? ModerationRuleAction.record) as ModerationRuleAction,
        sources: dto.sources.join(","),
        keywords: dto.keywords?.trim() || null,
        threshold: dto.threshold ?? 1,
        windowSeconds: dto.windowSeconds ?? 60,
        enabled: dto.enabled ?? true,
        createdById: user.id,
      },
    });
    return this.toRule(item);
  }

  async updateRule(user: AuthenticatedUser, id: number, dto: UpdateModerationRuleDto): Promise<ModerationRuleResponse> {
    this.assertSuperAdmin(user);
    const existing = await this.prisma.moderationRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("治理规则不存在。");
    const item = await this.prisma.moderationRule.update({
      where: { id },
      data: this.ruleData(dto, existing),
    });
    return this.toRule(item);
  }

  async deleteRule(user: AuthenticatedUser, id: number): Promise<{ success: true }> {
    this.assertSuperAdmin(user);
    await this.prisma.moderationRule.delete({ where: { id } });
    return { success: true };
  }

  async listRuleHits(query: ListModerationRuleHitsQueryDto): Promise<{
    items: ModerationRuleHitResponse[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const total = await this.prisma.moderationRuleHit.count();
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const items = await this.prisma.moderationRuleHit.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        rule: { select: { id: true, name: true, type: true } },
        actor: { select: { id: true, nickname: true, username: true, avatarStoredName: true } },
      },
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        rule: { id: item.rule.id, name: item.rule.name, type: item.rule.type },
        actor: {
          id: item.actor.id,
          nickname: item.actor.nickname,
          username: item.actor.username,
          avatarUrl: item.actor.avatarStoredName ? `/auth/avatars/${item.actor.avatarStoredName}` : null,
        },
        source: item.source,
        action: item.action,
        contentPreview: item.contentPreview,
        detail: item.detail,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  async listTemplates(): Promise<{ items: ModerationTemplateResponse[] }> {
    const items = await this.prisma.moderationTemplate.findMany({ orderBy: [{ enabled: "desc" }, { id: "desc" }] });
    return { items: items.map((item) => this.toTemplate(item)) };
  }

  async createTemplate(user: AuthenticatedUser, dto: CreateModerationTemplateDto): Promise<ModerationTemplateResponse> {
    this.assertSuperAdmin(user);
    const item = await this.prisma.moderationTemplate.create({
      data: {
        name: dto.name.trim(),
        status: dto.status,
        content: dto.content.trim(),
        enabled: dto.enabled ?? true,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    return this.toTemplate(item);
  }

  async updateTemplate(user: AuthenticatedUser, id: number, dto: UpdateModerationTemplateDto): Promise<ModerationTemplateResponse> {
    this.assertSuperAdmin(user);
    const item = await this.prisma.moderationTemplate.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.status === undefined ? {} : { status: dto.status }),
        ...(dto.content === undefined ? {} : { content: dto.content.trim() }),
        ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
        updatedById: user.id,
      },
    });
    return this.toTemplate(item);
  }

  async deleteTemplate(user: AuthenticatedUser, id: number): Promise<{ success: true }> {
    this.assertSuperAdmin(user);
    await this.prisma.moderationTemplate.delete({ where: { id } });
    return { success: true };
  }

  async getSettings(): Promise<ModerationSettingsResponse> {
    const item = await this.settingsRecord();
    return this.toSettings(item);
  }

  async updateSettings(user: AuthenticatedUser, dto: UpdateModerationSettingsDto): Promise<ModerationSettingsResponse> {
    this.assertSuperAdmin(user);
    if (dto.reminderLeadHours >= dto.deadlineHours) {
      throw new BadRequestException("提醒提前时间必须小于处理时限。");
    }
    const item = await this.prisma.moderationSetting.upsert({
      where: { id: 1 },
      create: { id: 1, ...dto, updatedById: user.id },
      update: { ...dto, updatedById: user.id },
    });
    return this.toSettings(item);
  }

  async getOverview(): Promise<ModerationOverviewResponse> {
    const [settings, comments, articles, groups, hits] = await Promise.all([
      this.settingsRecord(),
      this.prisma.articleCommentReport.findMany({ select: { status: true, createdAt: true, handledAt: true } }),
      this.prisma.articleReport.findMany({ select: { status: true, createdAt: true, handledAt: true } }),
      this.prisma.chatGroupMessageReport.findMany({ select: { status: true, createdAt: true, handledAt: true } }),
      this.prisma.moderationRuleHit.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000) } },
        select: { createdAt: true, rule: { select: { type: true } } },
      }),
    ]);
    const deadlineAt = Date.now() - settings.deadlineHours * 60 * 60 * 1_000;
    const bySource = {
      comment: this.reportStats(comments, deadlineAt),
      article: this.reportStats(articles, deadlineAt),
      group_message: this.reportStats(groups, deadlineAt),
    };
    const all = [...comments, ...articles, ...groups];
    const handled = all.filter((item) => item.handledAt);
    const averageHandleMinutes = handled.length
      ? Math.round(handled.reduce((total, item) => total + ((item.handledAt!.getTime() - item.createdAt.getTime()) / 60_000), 0) / handled.length)
      : null;
    const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1_000;
    const typeCounts = new Map<ModerationRuleType, number>();
    for (const hit of hits) typeCounts.set(hit.rule.type, (typeCounts.get(hit.rule.type) ?? 0) + 1);
    return {
      reports: {
        total: all.length,
        pending: bySource.comment.pending + bySource.article.pending + bySource.group_message.pending,
        resolved: all.filter((item) => item.status === "resolved").length,
        rejected: all.filter((item) => item.status === "rejected").length,
        overdue: bySource.comment.overdue + bySource.article.overdue + bySource.group_message.overdue,
        averageHandleMinutes,
        bySource,
      },
      ruleHits: {
        last7Days: hits.filter((item) => item.createdAt.getTime() >= weekStart).length,
        last30Days: hits.length,
        byType: Array.from(typeCounts.entries()).map(([type, count]) => ({ type, count })),
      },
    };
  }

  async runDeadlineNotifications(): Promise<void> {
    const settings = await this.settingsRecord();
    if (!settings.automaticRemindersEnabled) return;
    const now = new Date();
    const deadlineAt = new Date(now.getTime() - settings.deadlineHours * 60 * 60 * 1_000);
    const approachingAt = new Date(now.getTime() - Math.max(0, settings.deadlineHours - settings.reminderLeadHours) * 60 * 60 * 1_000);
    const [comments, articles, groups] = await Promise.all([
      this.prisma.articleCommentReport.findMany({ where: { status: ArticleCommentReportStatus.pending, createdAt: { lte: approachingAt } }, select: { id: true, createdAt: true } }),
      this.prisma.articleReport.findMany({ where: { status: ArticleCommentReportStatus.pending, createdAt: { lte: approachingAt } }, select: { id: true, createdAt: true } }),
      this.prisma.chatGroupMessageReport.findMany({ where: { status: ChatGroupReportStatus.pending, createdAt: { lte: approachingAt } }, select: { id: true, createdAt: true } }),
    ]);
    await Promise.all([
      ...comments.map((item) => this.notifyDeadline("comment", item, deadlineAt, settings.deadlineHours)),
      ...articles.map((item) => this.notifyDeadline("article", item, deadlineAt, settings.deadlineHours)),
      ...groups.map((item) => this.notifyDeadline("group_message", item, deadlineAt, settings.deadlineHours)),
    ]);
  }

  private ruleData(
    dto: CreateModerationRuleDto | UpdateModerationRuleDto,
    existing?: { name: string; type: ModerationRuleType; action: ModerationRuleAction; sources: string; keywords: string | null; threshold: number; windowSeconds: number; enabled: boolean },
  ) {
    const sources = dto.sources ?? existing?.sources.split(",").filter(Boolean) ?? [];
    if (!sources.length) throw new BadRequestException("请至少选择一个适用内容类型。");
    const type = "type" in dto ? dto.type : undefined;
    const keywords = dto.keywords === undefined ? (existing?.keywords ?? null) : dto.keywords.trim() || null;
    const effectiveType = type ?? existing?.type;
    if (effectiveType === ModerationRuleType.sensitive_word && !keywords) {
      throw new BadRequestException("敏感词规则必须填写关键词。");
    }
    return {
      ...("name" in dto && dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(type ? { type } : {}),
      action: dto.action ?? existing?.action ?? ModerationRuleAction.record,
      sources: sources.join(","),
      keywords,
      threshold: dto.threshold ?? existing?.threshold ?? 1,
      windowSeconds: dto.windowSeconds ?? existing?.windowSeconds ?? 60,
      enabled: dto.enabled ?? existing?.enabled ?? true,
    };
  }

  private toRule(item: {
    id: number;
    name: string;
    type: ModerationRuleType;
    action: ModerationRuleAction;
    sources: string;
    keywords: string | null;
    threshold: number;
    windowSeconds: number;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ModerationRuleResponse {
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      action: item.action,
      sources: item.sources.split(",").filter(Boolean) as ModerationReportSource[],
      keywords: item.keywords ?? "",
      threshold: item.threshold,
      windowSeconds: item.windowSeconds,
      enabled: item.enabled,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toTemplate(item: { id: number; name: string; status: string; content: string; enabled: boolean; createdAt: Date; updatedAt: Date }): ModerationTemplateResponse {
    return {
      id: item.id,
      name: item.name,
      status: item.status === "rejected" ? "rejected" : "resolved",
      content: item.content,
      enabled: item.enabled,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private async settingsRecord() {
    return this.prisma.moderationSetting.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  private toSettings(item: { deadlineHours: number; reminderLeadHours: number; automaticRemindersEnabled: boolean; updatedAt: Date }): ModerationSettingsResponse {
    return {
      deadlineHours: item.deadlineHours,
      reminderLeadHours: item.reminderLeadHours,
      automaticRemindersEnabled: item.automaticRemindersEnabled,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private reportStats(rows: Array<{ status: string; createdAt: Date }>, deadlineAt: number) {
    const pending = rows.filter((item) => item.status === "pending");
    return {
      total: rows.length,
      pending: pending.length,
      overdue: pending.filter((item) => item.createdAt.getTime() <= deadlineAt).length,
    };
  }

  private async notifyDeadline(
    source: ModerationReportSource,
    report: { id: number; createdAt: Date },
    deadlineAt: Date,
    deadlineHours: number,
  ): Promise<void> {
    const stage = report.createdAt <= deadlineAt ? ModerationDeadlineStage.overdue : ModerationDeadlineStage.approaching;
    try {
      await this.prisma.moderationDeadlineNotice.create({
        data: {
          source: source as ModerationContentSource,
          reportId: report.id,
          stage,
          dueAt: new Date(report.createdAt.getTime() + deadlineHours * 60 * 60 * 1_000),
        },
      });
    } catch {
      // The unique notice key prevents the scheduled job from repeating the same reminder.
      return;
    }
    const managers = await this.prisma.user.findMany({
      where: { status: "active", OR: [{ isSuperAdmin: true }, { isAdministrator: true }] },
      select: { id: true },
    });
    if (!managers.length) return;
    const sourceLabel = source === "article" ? "文章" : source === "comment" ? "评论" : "群消息";
    const title = stage === ModerationDeadlineStage.overdue ? "举报处理已超时" : "举报处理即将超时";
    await this.prisma.userNotification.createMany({
      data: managers.map((manager) => ({
        userId: manager.id,
        actorId: null,
        type: UserNotificationType.system,
        channel: UserNotificationChannel.system,
        title,
        body: `${sourceLabel}举报 #${report.id}${stage === ModerationDeadlineStage.overdue ? " 已超过处理时限，请尽快处理。" : " 即将达到处理时限，请及时处理。"}`,
        actionUrl: `/admin/reports?status=pending&source=${source}`,
      })),
    });
  }

  private assertSuperAdmin(user: AuthenticatedUser): void {
    if (!user.isSuperAdmin) throw new ForbiddenException("仅超级管理员可以配置内容治理规则。");
  }

  private fetchComments(type: ModerationReportSource | undefined, status: string | undefined, take: number) {
    if (type && type !== "comment") return Promise.resolve([] as ModerationReportResponse[]);
    return this.prisma.articleCommentReport.findMany({
      where: status ? { status: status as ArticleCommentReportStatus } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: commentReportSelect,
    }).then((rows) => rows.map((row) => this.toCommentReport(row)));
  }

  private fetchArticles(type: ModerationReportSource | undefined, status: string | undefined, take: number) {
    if (type && type !== "article") return Promise.resolve([] as ModerationReportResponse[]);
    return this.prisma.articleReport.findMany({
      where: status ? { status: status as ArticleCommentReportStatus } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: articleReportSelect,
    }).then((rows) => rows.map((row) => this.toArticleReport(row)));
  }

  private fetchGroups(type: ModerationReportSource | undefined, status: string | undefined, take: number) {
    if (type && type !== "group_message") return Promise.resolve([] as ModerationReportResponse[]);
    return this.prisma.chatGroupMessageReport.findMany({
      where: status ? { status: status as ChatGroupReportStatus } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: groupReportSelect,
    }).then((rows) => rows.map((row) => this.toGroupReport(row)));
  }

  private countComments(type: ModerationReportSource | undefined, status?: string) {
    if (type && type !== "comment") return Promise.resolve(0);
    return this.prisma.articleCommentReport.count({ where: status ? { status: status as ArticleCommentReportStatus } : undefined });
  }

  private countArticles(type: ModerationReportSource | undefined, status?: string) {
    if (type && type !== "article") return Promise.resolve(0);
    return this.prisma.articleReport.count({ where: status ? { status: status as ArticleCommentReportStatus } : undefined });
  }

  private countGroups(type: ModerationReportSource | undefined, status?: string) {
    if (type && type !== "group_message") return Promise.resolve(0);
    return this.prisma.chatGroupMessageReport.count({ where: status ? { status: status as ChatGroupReportStatus } : undefined });
  }

  private toUser(user: {
    id: number;
    nickname: string;
    username: string;
    avatarStoredName: string | null;
    isSuperAdmin: boolean;
    isAdministrator: boolean;
    role: { code: string; name: string; level: number };
  }): ModerationUserResponse {
    return {
      id: user.id,
      nickname: user.nickname,
      username: user.username,
      avatarUrl: user.avatarStoredName ? `/auth/avatars/${user.avatarStoredName}` : null,
      isSuperAdmin: user.isSuperAdmin,
      isAdministrator: user.isAdministrator,
      role: user.role,
    };
  }

  private toCommentReport(report: CommentReportRecord): ModerationReportResponse {
    const article = report.comment.article;
    return {
      key: `comment-${report.id}`,
      id: report.id,
      source: "comment",
      sourceLabel: "评论举报",
      status: report.status,
      reason: report.reason,
      detail: report.detail,
      resolution: report.resolution,
      reporter: this.toUser(report.reporter),
      targetUser: this.toUser(report.comment.author),
      article: { id: article.id, title: article.title, slug: article.slug, author: this.toUser(article.author) },
      comment: { id: report.comment.id, body: report.comment.body, status: report.comment.status },
      group: null,
      message: null,
      createdAt: report.createdAt.toISOString(),
      handledAt: report.handledAt?.toISOString() ?? null,
    };
  }

  private toArticleReport(report: ArticleReportRecord): ModerationReportResponse {
    return {
      key: `article-${report.id}`,
      id: report.id,
      source: "article",
      sourceLabel: "文章举报",
      status: report.status,
      reason: report.reason,
      detail: report.detail,
      resolution: report.resolution,
      reporter: this.toUser(report.reporter),
      targetUser: this.toUser(report.article.author),
      article: { id: report.article.id, title: report.article.title, slug: report.article.slug, author: this.toUser(report.article.author) },
      comment: null,
      group: null,
      message: null,
      createdAt: report.createdAt.toISOString(),
      handledAt: report.handledAt?.toISOString() ?? null,
    };
  }

  private toGroupReport(report: GroupReportRecord): ModerationReportResponse {
    return {
      key: `group_message-${report.id}`,
      id: report.id,
      source: "group_message",
      sourceLabel: "群消息举报",
      status: report.status,
      reason: report.reason,
      detail: report.detail,
      resolution: report.resolution,
      reporter: this.toUser(report.reporter),
      targetUser: this.toUser(report.message.sender),
      article: null,
      comment: null,
      group: {
        id: report.group.id,
        conversationId: report.group.conversationId,
        name: report.group.name,
        avatarUrl: report.group.avatarStoredName ? `/social/groups/avatars/${report.group.avatarStoredName}` : report.group.avatarUrl,
      },
      message: {
        id: report.message.id,
        body: report.message.body,
        type: report.message.type,
        sender: this.toUser(report.message.sender),
        attachments: report.message.attachments.map((attachment) => ({
          id: attachment.id,
          conversationId: attachment.conversationId,
          kind: attachment.kind,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          downloadUrl: `/social/attachments/${attachment.id}/download`,
          thumbnailUrl: attachment.kind === "image" ? `/social/attachments/${attachment.id}/thumbnail` : null,
          createdAt: attachment.createdAt.toISOString(),
        })),
        createdAt: report.message.createdAt.toISOString(),
      },
      createdAt: report.createdAt.toISOString(),
      handledAt: report.handledAt?.toISOString() ?? null,
    };
  }
}
