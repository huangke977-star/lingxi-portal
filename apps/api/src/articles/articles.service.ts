import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
  ArticleCommentReportReason,
  ArticleCommentReportStatus,
  ArticleCommentStatus,
  ChatAttachmentKind,
  ArticleAppealStatus,
  ArticleContentFormat,
  ArticleStatus,
  ArticleTopicStatus,
  ArticleVersionSource,
  ArticleVisibility,
  PortalVisibility,
  Prisma,
  RecommendationTargetType,
  UserNotificationChannel,
  UserNotificationType,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { ReputationService } from "../reputation/reputation.service";
import { buildSearchFields } from "../search/search-normalization";
import { SiteSettingsService } from "../site-settings/site-settings.service";
import { ContentModerationService } from "../moderation/content-moderation.service";
import {
  ARTICLE_STATUSES,
  ArticleStatusValue,
  ArticleScheduleDto,
  ArticleTemplateDto,
  AutosaveArticleDto,
  CreateArticleCommentDto,
  CreateArticleAppealDto,
  CreateArticleDto,
  ListArticleCommentsQueryDto,
  ListArticlesQueryDto,
  ModerateArticleCommentDto,
  ModerateArticleCommentReportDto,
  ModerateArticleDto,
  ModerateArticleReportDto,
  ModerateArticleAppealDto,
  RedeemArticleResourceDto,
  ReportArticleDto,
  ReportArticleCommentDto,
  UpdateArticleDto,
  UpdateArticlePublishRestrictionDto,
} from "./dto/article.dto";
import {
  ArticleAuthorResponse,
  ArticleAttachmentResponse,
  ArticleAppealResponse,
  ArticleCenterSummaryResponse,
  ArticleCommentResponse,
  ArticleCommentReportResponse,
  ArticleReportResponse,
  ArticleCommentReportSummaryResponse,
  ArticleCommentsResponse,
  ArticleInteractionResponse,
  ArticleListResponse,
  ArticleMineDashboardResponse,
  ArticleMineSummaryResponse,
  ArticleResponse,
  ArticlePublishCheckResponse,
  ArticleScheduleListResponse,
  ArticleTemplateResponse,
  ArticleReadLaterResponse,
  ArticleVersionResponse,
  ArticleVersionSummaryResponse,
  ReadingProgressResponse,
  ViolationAuthorResponse,
  ArticleCommentAttachmentResponse,
} from "./articles.types";
import {
  articleContentToPlainText,
  normalizeArticleContent,
  parseArticleContent,
} from "./article-resources";
import { ChatAttachmentsService, type StoredChatAttachmentInfo } from "../social/chat-attachments.service";
import type { UploadedChatAttachment } from "../social/chat-attachment.storage";

export const ARTICLE_IMAGE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const ARTICLE_IMAGE_MAX_FILES_PER_ARTICLE = 20;
const noOpContentModerationService: Pick<ContentModerationService, "enforce" | "recordAccepted"> = {
  enforce: async () => undefined,
  recordAccepted: async () => undefined,
};

export interface UploadedArticleImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

interface SupportedArticleImageFormat {
  extension: string;
  extensions: string[];
  mimeType: string;
  matches: (buffer: Buffer) => boolean;
}

const ARTICLE_IMAGE_FORMATS: SupportedArticleImageFormat[] = [
  {
    extension: ".jpg",
    extensions: [".jpg", ".jpeg"],
    mimeType: "image/jpeg",
    matches: (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
  {
    extension: ".png",
    extensions: [".png"],
    mimeType: "image/png",
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    extension: ".webp",
    extensions: [".webp"],
    mimeType: "image/webp",
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP",
  },
  {
    extension: ".avif",
    extensions: [".avif"],
    mimeType: "image/avif",
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.subarray(4, 8).toString("ascii") === "ftyp" &&
      ["avif", "avis"].includes(buffer.subarray(8, 12).toString("ascii")),
  },
];

const ARTICLE_AUTOSAVE_VERSION_LIMIT = 50;
const ARTICLE_LIFECYCLE_TICK_MS = 30_000;

const ARTICLE_VERSION_FIELDS = [
  "title",
  "summary",
  "content",
  "contentFormat",
  "category",
  "tags",
  "titleColor",
  "visibility",
  "status",
  "roleCodes",
  "isPointResource",
  "pointCost",
] as const;

const articleInclude = {
  author: {
    select: {
      id: true,
      nickname: true,
      username: true,
      avatarStoredName: true,
      isSuperAdmin: true,
      isAdministrator: true,
      role: { select: { code: true, name: true, level: true } },
    },
  },
  allowedRoles: {
    orderBy: { role: { level: "asc" as const } },
    select: {
      role: {
        select: { code: true, name: true, level: true },
      },
    },
  },
  images: {
    orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
    select: { storedName: true },
  },
  likes: { select: { userId: true } },
  favorites: { select: { userId: true } },
  collectionItems: {
    orderBy: { collection: { sortOrder: "asc" as const } },
    select: {
      collection: {
        select: { id: true, ownerId: true, name: true, visibility: true },
      },
    },
  },
  topicItems: {
    orderBy: { topic: { sortOrder: "asc" as const } },
    select: {
      topic: {
        select: {
          id: true,
          title: true,
          slug: true,
          visibility: true,
          status: true,
          allowedRoles: { select: { role: { select: { code: true } } } },
        },
      },
    },
  },
  comments: {
    where: { status: ArticleCommentStatus.active },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    distinct: ["authorId" as const],
    take: 5,
    select: {
      authorId: true,
      author: {
        select: {
          id: true,
          nickname: true,
          username: true,
          avatarStoredName: true,
          isSuperAdmin: true,
          isAdministrator: true,
          role: { select: { code: true, name: true, level: true } },
        },
      },
    },
  },
} satisfies Prisma.ArticleInclude;

type ArticleRecord = Prisma.ArticleGetPayload<{ include: typeof articleInclude }>;

interface ArticleReaderState {
  readLater: boolean;
  readingProgress: number | null;
  lastReadAt: Date | null;
  unlockedResourceKeys: Set<string>;
}

interface RecommendationCandidate {
  id: number;
  authorId: number;
  category: string;
  tags: string;
  isPinned: boolean;
  publishedAt: Date | null;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  commentCount: number;
}

const commentReportInclude = {
  comment: {
    select: {
      body: true,
      status: true,
      attachments: {
        orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
        select: {
          id: true,
          kind: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      },
      article: { select: { id: true, title: true, slug: true } },
    },
  },
  reporter: {
    select: {
      id: true,
      nickname: true,
      username: true,
      avatarStoredName: true,
      isSuperAdmin: true,
      isAdministrator: true,
      role: { select: { code: true, name: true, level: true } },
    },
  },
} satisfies Prisma.ArticleCommentReportInclude;

const articleReportInclude = {
  article: { select: { id: true, title: true, slug: true } },
  reporter: {
    select: {
      id: true,
      nickname: true,
      username: true,
      avatarStoredName: true,
      isSuperAdmin: true,
      isAdministrator: true,
      role: { select: { code: true, name: true, level: true } },
    },
  },
} satisfies Prisma.ArticleReportInclude;

const articleAppealInclude = {
  article: { select: { id: true, title: true, slug: true, status: true } },
  author: {
    select: {
      id: true,
      nickname: true,
      username: true,
      avatarStoredName: true,
      isSuperAdmin: true,
      isAdministrator: true,
      role: { select: { code: true, name: true, level: true } },
    },
  },
} satisfies Prisma.ArticleAppealInclude;

type CommentReportRecord = Prisma.ArticleCommentReportGetPayload<{
  include: typeof commentReportInclude;
}>;

type ArticleReportRecord = Prisma.ArticleReportGetPayload<{
  include: typeof articleReportInclude;
}>;

type ArticleAppealRecord = Prisma.ArticleAppealGetPayload<{
  include: typeof articleAppealInclude;
}>;

function countDistinctReportPublications<T extends {
  publicationNumber: number;
  createdAt: Date;
}>(
  reports: readonly T[],
  articleIdOf: (report: T) => number,
  cutoff?: Date,
): number {
  return new Set(
    reports
      .filter((report) => !cutoff || report.createdAt >= cutoff)
      .map((report) => `${articleIdOf(report)}:${report.publicationNumber}`),
  ).size;
}

@Injectable()
export class ArticlesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ArticlesService.name);
  private lifecycleTimer: NodeJS.Timeout | null = null;
  private lifecycleProcessing = false;
  private readonly uploadDirectory = resolve(
    process.env.ARTICLE_UPLOAD_DIR ?? join(process.cwd(), "uploads", "articles"),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly siteSettingsService: SiteSettingsService,
    private readonly redis: RedisService,
    private readonly reputationService: ReputationService,
    @Inject(ContentModerationService)
    private readonly contentModerationService: Pick<ContentModerationService, "enforce" | "recordAccepted"> = noOpContentModerationService,
    @Optional() private readonly chatAttachmentsService?: ChatAttachmentsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.lifecycleTimer = setInterval(() => void this.processArticleLifecycleInBackground(), ARTICLE_LIFECYCLE_TICK_MS);
    this.lifecycleTimer.unref();
    setTimeout(() => void this.processArticleLifecycleInBackground(), 5_000).unref();
  }

  onModuleDestroy(): void {
    if (this.lifecycleTimer) clearInterval(this.lifecycleTimer);
  }

  listPublic(query: ListArticlesQueryDto): Promise<ArticleListResponse> {
    return this.listArticles(query, null, false);
  }

  listVisible(
    query: ListArticlesQueryDto,
    user: AuthenticatedUser,
  ): Promise<ArticleListResponse> {
    return this.listArticles(query, user, false);
  }

  async getCenterSummary(
    user: AuthenticatedUser | null,
  ): Promise<ArticleCenterSummaryResponse> {
    const visibleWhere = this.buildWhere(new ListArticlesQueryDto(), user, false, false);
    const canManage = Boolean(user?.isSuperAdmin || user?.isAdministrator);
    const subscriptionWhere: Prisma.ArticleWhereInput = user ? { AND: [
      visibleWhere,
      { author: { is: { subscriptionsReceived: { some: { subscriberId: user.id } } } } },
    ] } : { id: -1 };
    const [discover, subscriptions, mine, favorites, liked, readLater, history, manage] = await Promise.all([
      this.prisma.article.count({ where: visibleWhere }),
      user ? this.prisma.article.count({ where: subscriptionWhere }) : Promise.resolve(0),
      user
        ? this.prisma.article.count({
            where: { authorId: user.id, status: { not: ArticleStatus.deleted } },
          })
        : Promise.resolve(0),
      user
        ? this.prisma.articleFavorite.count({
            where: { userId: user.id, article: visibleWhere },
          })
        : Promise.resolve(0),
      user
        ? this.prisma.articleLike.count({
            where: { userId: user.id, article: visibleWhere },
          })
        : Promise.resolve(0),
      user
        ? this.prisma.articleReadLater.count({
            where: { userId: user.id, article: visibleWhere },
          })
        : Promise.resolve(0),
      user
        ? this.prisma.articleReadingHistory.count({
            where: { userId: user.id, article: visibleWhere },
          })
        : Promise.resolve(0),
      canManage ? this.prisma.article.count() : Promise.resolve(0),
    ]);

    return { discover, subscriptions, mine, favorites, liked, readLater, history, manage };
  }

  listMine(query: ListArticlesQueryDto, user: AuthenticatedUser): Promise<ArticleListResponse> {
    return this.listArticles(query, user, false, true);
  }

  listFavorites(query: ListArticlesQueryDto, user: AuthenticatedUser): Promise<ArticleListResponse> {
    return this.listInteractedArticles(query, user, "favorite");
  }

  listLiked(query: ListArticlesQueryDto, user: AuthenticatedUser): Promise<ArticleListResponse> {
    return this.listInteractedArticles(query, user, "like");
  }

  async listSubscriptions(query: ListArticlesQueryDto, user: AuthenticatedUser): Promise<ArticleListResponse> {
    const where: Prisma.ArticleWhereInput = { AND: [
      this.buildWhere(query, user, false, false),
      { author: { is: { subscriptionsReceived: { some: { subscriberId: user.id } } } } },
    ] };
    return this.listArticlesByWhere(query, user, where);
  }

  async listReadLater(query: ListArticlesQueryDto, user: AuthenticatedUser): Promise<ArticleListResponse> {
    const articleWhere = this.buildWhere(query, user, false, false);
    const relationWhere = { userId: user.id, article: articleWhere };
    const total = await this.prisma.articleReadLater.count({ where: relationWhere });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const records = await this.prisma.articleReadLater.findMany({
      where: relationWhere,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * query.pageSize,
      take: query.pageSize,
      select: { createdAt: true, article: { include: articleInclude } },
    });
    return {
      items: records.map(({ article }) => this.toResponse(article, user, {
        readLater: true,
        readingProgress: null,
        lastReadAt: null,
        unlockedResourceKeys: new Set<string>(),
      })),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  async listReadingHistory(query: ListArticlesQueryDto, user: AuthenticatedUser): Promise<ArticleListResponse> {
    const articleWhere = this.buildWhere(query, user, false, false);
    const relationWhere = { userId: user.id, article: articleWhere };
    const total = await this.prisma.articleReadingHistory.count({ where: relationWhere });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const records = await this.prisma.articleReadingHistory.findMany({
      where: relationWhere,
      orderBy: [{ lastReadAt: "desc" }],
      skip: (page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        progress: true,
        lastReadAt: true,
        article: { include: articleInclude },
      },
    });
    return {
      items: records.map(({ article, progress, lastReadAt }) => this.toResponse(article, user, {
        readLater: false,
        readingProgress: progress,
        lastReadAt,
        unlockedResourceKeys: new Set<string>(),
      })),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  async getMineSummary(user: AuthenticatedUser): Promise<ArticleMineSummaryResponse> {
    const [grouped, scheduledDrafts] = await Promise.all([
      this.prisma.article.groupBy({
        by: ["status"],
        where: { authorId: user.id },
        _count: { _all: true },
      }),
      this.prisma.article.count({
        where: {
          authorId: user.id,
          status: ArticleStatus.draft,
          OR: [
            { scheduledPublishAt: { not: null } },
            { scheduledUnpublishAt: { not: null } },
            { scheduleError: { not: null } },
          ],
        },
      }),
    ]);
    const summary: ArticleMineSummaryResponse = {
      total: 0,
      draft: 0,
      published: 0,
      unpublished: 0,
      blocked: 0,
      deleted: 0,
    };
    for (const item of grouped) {
      const count = item._count._all;
      summary[item.status] = count;
      summary.total += count;
    }
    summary.draft = Math.max(0, summary.draft - scheduledDrafts);
    return summary;
  }

  async getMineDashboard(user: AuthenticatedUser): Promise<ArticleMineDashboardResponse> {
    const articleWhere: Prisma.ArticleWhereInput = {
      authorId: user.id,
      status: { not: ArticleStatus.deleted },
    };
    const [articleTotals, resourceExchanges, pending, settled, recentResourceIncome] = await Promise.all([
      this.prisma.article.aggregate({
        where: articleWhere,
        _sum: { viewCount: true, likeCount: true, commentCount: true, favoriteCount: true },
      }),
      this.prisma.articleResourceExchange.count({ where: { authorId: user.id } }),
      this.prisma.articleResourceExchange.aggregate({
        where: { authorId: user.id, sellerSettledAt: null },
        _sum: { pointCost: true },
      }),
      this.prisma.articleResourceExchange.aggregate({
        where: { authorId: user.id, sellerSettledAt: { not: null } },
        _sum: { pointCost: true },
      }),
      this.prisma.articleResourceExchange.findMany({
        where: { authorId: user.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 8,
        select: {
          id: true,
          pointCost: true,
          createdAt: true,
          sellerAvailableAt: true,
          sellerSettledAt: true,
          article: { select: { id: true, title: true, slug: true } },
        },
      }),
    ]);
    return {
      views: articleTotals._sum.viewCount ?? 0,
      likes: articleTotals._sum.likeCount ?? 0,
      comments: articleTotals._sum.commentCount ?? 0,
      favorites: articleTotals._sum.favoriteCount ?? 0,
      resourceExchanges,
      pendingPoints: pending._sum.pointCost ?? 0,
      settledPoints: settled._sum.pointCost ?? 0,
      recentResourceIncome: recentResourceIncome.map((item) => ({
        id: item.id,
        article: item.article,
        pointCost: item.pointCost,
        createdAt: item.createdAt.toISOString(),
        availableAt: item.sellerAvailableAt.toISOString(),
        settledAt: item.sellerSettledAt?.toISOString() ?? null,
      })),
    };
  }

  async listMyArticleSchedules(user: AuthenticatedUser): Promise<ArticleScheduleListResponse> {
    const items = await this.prisma.article.findMany({
      where: { authorId: user.id, OR: [{ scheduledPublishAt: { not: null } }, { scheduledUnpublishAt: { not: null } }, { scheduleError: { not: null } }] },
      orderBy: [{ scheduledPublishAt: "asc" }, { scheduledUnpublishAt: "asc" }, { updatedAt: "desc" }],
      take: 100,
      select: { id: true, title: true, slug: true, status: true, scheduledPublishAt: true, scheduledUnpublishAt: true, scheduleError: true, updatedAt: true },
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        slug: item.slug,
        status: item.status,
        publishAt: item.scheduledPublishAt?.toISOString() ?? null,
        unpublishAt: item.scheduledUnpublishAt?.toISOString() ?? null,
        error: item.scheduleError,
        updatedAt: item.updatedAt.toISOString(),
      })),
    };
  }

  async listTemplates(user: AuthenticatedUser): Promise<{ items: ArticleTemplateResponse[] }> {
    const templates = await this.prisma.articleTemplate.findMany({
      where: { authorId: user.id },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 50,
    });
    return { items: templates.map((template) => this.toTemplateResponse(template)) };
  }

  async createTemplate(user: AuthenticatedUser, dto: ArticleTemplateDto): Promise<ArticleTemplateResponse> {
    const data = await this.normalizeTemplateInput(dto);
    try {
      const template = await this.prisma.articleTemplate.create({ data: { ...data, authorId: user.id } });
      return this.toTemplateResponse(template);
    } catch (error) {
      this.rethrowTemplatePersistenceError(error);
    }
  }

  async updateTemplate(id: number, user: AuthenticatedUser, dto: ArticleTemplateDto): Promise<ArticleTemplateResponse> {
    const existing = await this.prisma.articleTemplate.findFirst({ where: { id, authorId: user.id } });
    if (!existing) throw new NotFoundException("文章模板不存在。");
    const data = await this.normalizeTemplateInput(dto);
    try {
      const template = await this.prisma.articleTemplate.update({ where: { id }, data });
      return this.toTemplateResponse(template);
    } catch (error) {
      this.rethrowTemplatePersistenceError(error);
    }
  }

  async deleteTemplate(id: number, user: AuthenticatedUser): Promise<{ success: true }> {
    const result = await this.prisma.articleTemplate.deleteMany({ where: { id, authorId: user.id } });
    if (!result.count) throw new NotFoundException("文章模板不存在。");
    return { success: true };
  }

  async getPublishCheck(id: number, user: AuthenticatedUser): Promise<ArticlePublishCheckResponse> {
    const article = await this.getArticleOrThrow(id);
    this.assertCanEdit(article, user);
    return this.publishCheckFor(article, user);
  }

  async schedule(id: number, user: AuthenticatedUser, dto: ArticleScheduleDto): Promise<ArticleResponse> {
    const existing = await this.getArticleOrThrow(id);
    this.assertCanEdit(existing, user);
    if (existing.status === ArticleStatus.blocked || existing.status === ArticleStatus.deleted) {
      throw new BadRequestException("受限或已删除的文章不能设置发布计划。");
    }
    const publishAt = dto.publishAt === undefined ? existing.scheduledPublishAt : this.parseScheduleDate(dto.publishAt, "发布");
    const unpublishAt = dto.unpublishAt === undefined ? existing.scheduledUnpublishAt : this.parseScheduleDate(dto.unpublishAt, "下线");
    const now = new Date();
    const clearing = dto.publishAt === null && dto.unpublishAt === null;
    if (!publishAt && !unpublishAt && !clearing) throw new BadRequestException("请至少设置发布时间或下线时间。");
    if (publishAt && publishAt <= now) throw new BadRequestException("发布时间必须晚于当前时间。");
    if (unpublishAt && unpublishAt <= now) throw new BadRequestException("下线时间必须晚于当前时间。");
    if (existing.status === ArticleStatus.published && publishAt) throw new BadRequestException("已发布文章不能再次设置发布时间。");
    if (existing.status !== ArticleStatus.published && unpublishAt && !publishAt) throw new BadRequestException("草稿需要同时设置未来的发布时间和下线时间。");
    if (publishAt && unpublishAt && unpublishAt <= publishAt) throw new BadRequestException("下线时间必须晚于发布时间。");
    if (publishAt) {
      const check = await this.publishCheckFor(existing, user);
      if (check.errors.length) throw new BadRequestException(check.errors.join("；"));
    }
    const article = await this.prisma.article.update({
      where: { id },
      data: { scheduledPublishAt: publishAt, scheduledUnpublishAt: unpublishAt, scheduleError: null },
      include: articleInclude,
    });
    const notification = clearing
      ? {
          title: "文章发布计划已取消",
          body: `《${article.title}》的发布计划已取消。`,
          bodyEn: `The publishing schedule for “${article.title}” has been cancelled.`,
        }
      : publishAt
        ? {
            title: "文章发布计划已保存",
            body: `《${article.title}》将在 ${publishAt.toLocaleString("zh-CN")} 自动发布。`,
            bodyEn: `“${article.title}” is scheduled to publish at ${publishAt.toISOString()}.`,
          }
        : {
            title: "文章下线计划已保存",
            body: `《${article.title}》将在 ${unpublishAt!.toLocaleString("zh-CN")} 自动下线。`,
            bodyEn: `“${article.title}” is scheduled to go offline at ${unpublishAt!.toISOString()}.`,
          };
    await this.prisma.userNotification.create({
      data: {
        userId: user.id,
        actorId: user.id,
        type: UserNotificationType.system,
        channel: UserNotificationChannel.system,
        ...notification,
        actionUrl: "/articles/mine",
      },
    });
    return this.toResponse(article, user);
  }

  async processArticleLifecycle(): Promise<void> {
    if (this.lifecycleProcessing) return;
    this.lifecycleProcessing = true;
    try {
      const now = new Date();
      const publishCandidates = await this.prisma.article.findMany({
        where: { status: { in: [ArticleStatus.draft, ArticleStatus.unpublished] }, scheduledPublishAt: { lte: now } },
        select: { id: true },
        orderBy: [{ scheduledPublishAt: "asc" }, { id: "asc" }],
        take: 20,
      });
      for (const item of publishCandidates) await this.processScheduledPublication(item.id, now);
      const unpublishCandidates = await this.prisma.article.findMany({
        where: { status: ArticleStatus.published, scheduledUnpublishAt: { lte: now } },
        select: { id: true },
        orderBy: [{ scheduledUnpublishAt: "asc" }, { id: "asc" }],
        take: 20,
      });
      for (const item of unpublishCandidates) await this.processScheduledUnpublication(item.id, now);
    } finally {
      this.lifecycleProcessing = false;
    }
  }

  private async processArticleLifecycleInBackground(): Promise<void> {
    await this.processArticleLifecycle().catch((error) => this.logger.warn(`Article lifecycle task failed: ${this.errorMessage(error)}`));
  }

  private async processScheduledPublication(id: number, now: Date): Promise<void> {
    const claimed = await this.prisma.article.updateMany({
      where: { id, status: { in: [ArticleStatus.draft, ArticleStatus.unpublished] }, scheduledPublishAt: { lte: now } },
      data: { scheduledPublishAt: null, scheduleError: null },
    });
    if (!claimed.count) return;
    const existing = await this.getArticleOrThrow(id);
    try {
      const author = await this.scheduledAuthor(existing.authorId);
      if (!author) throw new BadRequestException("文章作者账号不存在或已停用。");
      const check = await this.publishCheckFor(existing, author);
      if (check.errors.length) throw new BadRequestException(check.errors.join("；"));
      await this.contentModerationService.enforce({ source: "article", actorId: author.id, content: `${existing.title}\n${existing.content}`, contentRef: `article:${id}` });
      const isFirstPublication = existing.publishedAt === null;
      const updated = await this.prisma.$transaction(async (transaction) => {
        const article = await transaction.article.update({
          where: { id },
          data: { status: ArticleStatus.published, publicationCount: { increment: 1 }, publishedAt: existing.publishedAt ?? now, blockedReason: null, scheduleError: null },
          include: articleInclude,
        });
        await this.createVersionSnapshot(transaction, article, author.id, ArticleVersionSource.publish);
        if (isFirstPublication) {
          await this.reputationService.awardArticlePublished(transaction, author.id, article.id);
          await this.notifySubscribersOfPublication(transaction, article);
        }
        await transaction.userNotification.create({
          data: { userId: author.id, actorId: null, type: UserNotificationType.article_scheduled_publish, channel: UserNotificationChannel.system, title: "文章已按计划发布", body: `《${article.title}》已按计划发布。`, bodyEn: `“${article.title}” was published on schedule.`, actionUrl: `/articles/${article.slug}`, articleId: article.id },
        });
        return article;
      });
      await this.contentModerationService.recordAccepted({ source: "article", actorId: author.id, content: `${updated.title}\n${updated.content}`, contentRef: `article:${id}` });
    } catch (error) {
      const message = this.errorMessage(error).slice(0, 500);
      await this.prisma.article.update({ where: { id }, data: { scheduleError: message } });
      const article = await this.prisma.article.findUnique({ where: { id }, select: { authorId: true, title: true } });
      if (article) await this.prisma.userNotification.create({ data: { userId: article.authorId, actorId: null, type: UserNotificationType.article_scheduled_publish_failed, channel: UserNotificationChannel.system, title: "文章定时发布失败", body: `《${article.title}》未能按计划发布：${message}`, bodyEn: `Scheduled publication of “${article.title}” failed: ${message}`, actionUrl: "/articles/mine", articleId: id } });
    }
  }

  private async processScheduledUnpublication(id: number, now: Date): Promise<void> {
    const claimed = await this.prisma.article.updateMany({ where: { id, status: ArticleStatus.published, scheduledUnpublishAt: { lte: now } }, data: { status: ArticleStatus.unpublished, scheduledUnpublishAt: null, scheduleError: null } });
    if (!claimed.count) return;
    const article = await this.prisma.article.findUnique({ where: { id }, select: { authorId: true, title: true, slug: true } });
    if (!article) return;
    await this.prisma.userNotification.create({ data: { userId: article.authorId, actorId: null, type: UserNotificationType.article_scheduled_unpublish, channel: UserNotificationChannel.system, title: "文章已按计划下线", body: `《${article.title}》已按计划下线。`, bodyEn: `“${article.title}” was taken offline on schedule.`, actionUrl: "/articles/mine", articleId: id } });
  }

  async getMineById(id: number, user: AuthenticatedUser): Promise<ArticleResponse> {
    const article = await this.getArticleOrThrow(id);
    this.assertCanEdit(article, user);
    return this.toResponse(article, user);
  }

  listAdmin(query: ListArticlesQueryDto): Promise<ArticleListResponse> {
    return this.listArticles(query, null, true);
  }

  async getPublicBySlug(slug: string, visitorKey: string): Promise<ArticleResponse> {
    return this.getBySlug(slug, null, visitorKey);
  }

  async getVisibleBySlug(
    slug: string,
    user: AuthenticatedUser,
    visitorKey: string,
  ): Promise<ArticleResponse> {
    return this.getBySlug(slug, user, visitorKey);
  }

  async listComments(
    slug: string,
    user: AuthenticatedUser | null,
    query: ListArticleCommentsQueryDto,
  ): Promise<ArticleCommentsResponse> {
    const article = await this.getArticleBySlug(slug);
    this.assertCanRead(article, user);
    const commentIndex = await this.prisma.articleComment.findMany({
      where: { articleId: article.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, parentId: true, status: true },
    });
    const includedIds = this.visibleCommentIds(commentIndex);
    const indexById = new Map(commentIndex.map((comment) => [comment.id, comment]));
    const rootIds = commentIndex
      .filter((comment) => comment.parentId === null && includedIds.has(comment.id))
      .map((comment) => comment.id);
    const cursorIndex = query.cursor ? rootIds.indexOf(query.cursor) : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageRootIds = rootIds.slice(startIndex, startIndex + query.pageSize);
    const selectedRootIds = new Set(pageRootIds);
    if (query.focusId && includedIds.has(query.focusId)) {
      selectedRootIds.add(this.commentThreadRootId(query.focusId, indexById));
    }
    const selectedCommentIds = commentIndex
      .filter((comment) => includedIds.has(comment.id) && selectedRootIds.has(this.commentThreadRootId(comment.id, indexById)))
      .map((comment) => comment.id);
    const comments = selectedCommentIds.length ? await this.prisma.articleComment.findMany({
      where: { id: { in: selectedCommentIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: this.commentSelect(),
    }) : [];
    const commentIds = comments.map((comment) => comment.id);
    const [likes, reports] = user && commentIds.length
      ? await Promise.all([
          this.prisma.articleCommentLike.findMany({
            where: { userId: user.id, commentId: { in: commentIds } },
            select: { commentId: true },
          }),
          this.prisma.articleCommentReport.findMany({
            where: { reporterId: user.id, commentId: { in: commentIds }, status: ArticleCommentReportStatus.pending },
            select: { commentId: true },
          }),
        ])
      : [[], []];
    const likedIds = new Set(likes.map((like) => like.commentId));
    const reportedIds = new Set(reports.map((report) => report.commentId));
    const hasMore = startIndex + query.pageSize < rootIds.length;
    return {
      items: comments.map((comment) => this.toCommentResponse(comment, {
        liked: likedIds.has(comment.id),
        reported: reportedIds.has(comment.id),
        sanitizeHiddenBody: true,
      })),
      hasMore,
      nextCursor: hasMore ? pageRootIds.at(-1) ?? null : null,
      totalThreads: rootIds.length,
    };
  }

  async create(user: AuthenticatedUser, dto: CreateArticleDto): Promise<ArticleResponse> {
    const publishPolicy = await this.siteSettingsService.getArticlePublishPolicy();
    const title = dto.title.trim();
    const contentFormat = dto.contentFormat === "html" ? ArticleContentFormat.html : ArticleContentFormat.markdown;
    const content = normalizeArticleContent(dto.content, contentFormat);
    if (!title || !content) {
      throw new BadRequestException("文章标题和正文不能为空。");
    }
    const resource = this.resourceSummary(content, contentFormat);

    const visibility = dto.visibility ?? publishPolicy.defaultArticleVisibility;
    const roles = await this.resolveRoles(visibility, dto.roleCodes ?? []);
    const status = this.normalizeAuthorStatus(dto.status);
    if (status === ArticleStatus.published) await this.assertArticlePublishAllowed(user);
    if (status === ArticleStatus.published) {
      await this.contentModerationService.enforce({ source: "article", actorId: user.id, content: `${title}\n${articleContentToPlainText(content, contentFormat)}` });
    }
    const slug = await this.createUniqueSlug(title);
    const tags = this.normalizeTags(dto.tags);
    const article = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.article.create({ data: {
        authorId: user.id,
        title,
        slug,
        summary: dto.summary?.trim() ?? "",
        content,
        contentFormat,
        category: dto.category?.trim() ?? "",
        tags,
        titleColor: this.normalizeTitleColor(dto.titleColor),
        visibility,
        status,
        publicationCount: status === ArticleStatus.published ? 1 : 0,
        publishedAt: status === ArticleStatus.published ? new Date() : null,
        ...resource,
        ...buildSearchFields([title, dto.category?.trim() ?? "", tags]),
        allowedRoles: { create: roles.map((role) => ({ roleId: role.id })) },
      }, include: articleInclude });
      await this.createVersionSnapshot(transaction, created, user.id, status === ArticleStatus.published ? ArticleVersionSource.publish : ArticleVersionSource.manual);
      if (status === ArticleStatus.published) {
        await this.reputationService.awardArticlePublished(transaction, user.id, created.id);
        await this.notifySubscribersOfPublication(transaction, created);
      }
      return created;
    });
    if (status === ArticleStatus.published) {
      await this.contentModerationService.recordAccepted({ source: "article", actorId: user.id, content: `${title}\n${articleContentToPlainText(content, contentFormat)}`, contentRef: `article:${article.id}` });
    }
    return this.toResponse(article, user);
  }

  async createAutosave(user: AuthenticatedUser, dto: AutosaveArticleDto): Promise<ArticleResponse> {
    const publishPolicy = await this.siteSettingsService.getArticlePublishPolicy();
    const title = dto.title?.trim() ?? "";
    const category = dto.category?.trim() ?? "";
    const tags = this.normalizeTags(dto.tags);
    const contentFormat = dto.contentFormat === "html" ? ArticleContentFormat.html : ArticleContentFormat.markdown;
    const content = normalizeArticleContent(dto.content ?? "", contentFormat);
    const resource = this.resourceSummary(content, contentFormat);
    const visibility = dto.visibility ?? publishPolicy.defaultArticleVisibility;
    const roles = await this.resolveRoles(visibility, dto.roleCodes ?? []);
    const slug = await this.createUniqueSlug(title || "untitled-article");
    const article = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.article.create({
        data: {
          authorId: user.id,
          title,
          slug,
          summary: dto.summary?.trim() ?? "",
          content,
          contentFormat,
          category,
          tags,
          titleColor: this.normalizeTitleColor(dto.titleColor),
          visibility,
          status: ArticleStatus.draft,
          ...resource,
          ...buildSearchFields([title, category, tags]),
          allowedRoles: { create: roles.map((role) => ({ roleId: role.id })) },
        },
        include: articleInclude,
      });
      await this.createVersionSnapshot(transaction, created, user.id, ArticleVersionSource.autosave);
      return created;
    });
    return this.toResponse(article, user);
  }

  async autosave(
    id: number,
    user: AuthenticatedUser,
    dto: AutosaveArticleDto,
  ): Promise<ArticleResponse> {
    const existing = await this.getArticleOrThrow(id);
    this.assertCanEdit(existing, user);
    if (existing.status === ArticleStatus.deleted) {
      throw new BadRequestException("回收站中的文章不能自动保存。");
    }
    const title = dto.title === undefined ? existing.title : dto.title.trim();
    const contentFormat = dto.contentFormat === undefined ? existing.contentFormat : (dto.contentFormat === "html" ? ArticleContentFormat.html : ArticleContentFormat.markdown);
    const content = dto.content === undefined ? existing.content : normalizeArticleContent(dto.content, contentFormat);
    const resource = this.resourceSummary(content, contentFormat);
    const category = dto.category === undefined ? existing.category : dto.category.trim();
    const tags = dto.tags === undefined ? existing.tags : this.normalizeTags(dto.tags);
    const visibility = dto.visibility ?? existing.visibility;
    const roles = await this.resolveRoles(visibility, dto.roleCodes ?? this.roleCodes(existing));
    const article = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.article.update({
        where: { id },
        data: {
          title,
          summary: dto.summary === undefined ? existing.summary : dto.summary.trim(),
          content,
          contentFormat,
          category,
          tags,
          titleColor: dto.titleColor === undefined ? existing.titleColor : this.normalizeTitleColor(dto.titleColor),
          visibility,
          ...resource,
          ...buildSearchFields([title, category, tags]),
          allowedRoles: {
            deleteMany: {},
            create: roles.map((role) => ({ roleId: role.id })),
          },
        },
        include: articleInclude,
      });
      await this.createVersionSnapshot(transaction, updated, user.id, ArticleVersionSource.autosave);
      return updated;
    });
    return this.toResponse(article, user);
  }

  async listVersions(id: number, user: AuthenticatedUser): Promise<{ items: ArticleVersionSummaryResponse[] }> {
    const article = await this.getArticleOrThrow(id);
    this.assertCanEdit(article, user);
    const versions = await this.prisma.articleVersion.findMany({
      where: { articleId: id },
      orderBy: [{ versionNumber: "desc" }],
      take: 100,
      select: {
        id: true,
        versionNumber: true,
        source: true,
        changedFields: true,
        createdAt: true,
        editor: { select: { id: true, username: true, nickname: true } },
      },
    });
    return { items: versions.map((version) => this.toVersionSummary(version)) };
  }

  async getVersion(id: number, versionId: number, user: AuthenticatedUser): Promise<ArticleVersionResponse> {
    const article = await this.getArticleOrThrow(id);
    this.assertCanEdit(article, user);
    const version = await this.prisma.articleVersion.findFirst({
      where: { id: versionId, articleId: id },
      include: { editor: { select: { id: true, username: true, nickname: true } } },
    });
    if (!version) throw new NotFoundException("文章版本不存在。");
    parseArticleContent(version.content, version.contentFormat);
    return this.toVersionResponse(version);
  }

  async restoreVersion(
    id: number,
    versionId: number,
    user: AuthenticatedUser,
  ): Promise<ArticleResponse> {
    const existing = await this.getArticleOrThrow(id);
    this.assertCanEdit(existing, user);
    if (existing.status === ArticleStatus.deleted) {
      throw new BadRequestException("请先从回收站恢复文章，再恢复历史版本。");
    }
    const version = await this.prisma.articleVersion.findFirst({
      where: { id: versionId, articleId: id },
    });
    if (!version) throw new NotFoundException("文章版本不存在。");
    const roleCodes = version.roleCodes.split(",").filter(Boolean);
    const roles = await this.resolveRoles(version.visibility, roleCodes);
    const resource = this.resourceSummary(version.content, version.contentFormat);
    const restoredStatus = existing.status === ArticleStatus.blocked ? ArticleStatus.blocked : ArticleStatus.draft;
    const article = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.article.update({
        where: { id },
        data: {
          title: version.title,
          summary: version.summary,
          content: version.content,
          contentFormat: version.contentFormat,
          category: version.category,
          tags: version.tags,
          titleColor: version.titleColor,
          visibility: version.visibility,
          status: restoredStatus,
          ...resource,
          ...buildSearchFields([version.title, version.category, version.tags]),
          allowedRoles: {
            deleteMany: {},
            create: roles.map((role) => ({ roleId: role.id })),
          },
        },
        include: articleInclude,
      });
      await this.createVersionSnapshot(transaction, updated, user.id, ArticleVersionSource.restore);
      return updated;
    });
    return this.toResponse(article, user);
  }

  async update(id: number, user: AuthenticatedUser, dto: UpdateArticleDto): Promise<ArticleResponse> {
    const existing = await this.getArticleOrThrow(id);
    this.assertCanEdit(existing, user);
    if (existing.status === ArticleStatus.deleted) {
      throw new BadRequestException("回收站中的文章需要先恢复才能编辑。");
    }
    const visibility = dto.visibility ?? existing.visibility;
    const roles = await this.resolveRoles(visibility, dto.roleCodes ?? this.roleCodes(existing));
    const requestedStatus = dto.status ? this.normalizeAuthorStatus(dto.status) : existing.status;
    const status = existing.status === ArticleStatus.blocked && !this.canManageContent(user)
      ? ArticleStatus.blocked
      : requestedStatus;
    if (status === ArticleStatus.published && !this.canManageContent(user)) await this.assertArticlePublishAllowed(user);
    const isFirstPublication = status === ArticleStatus.published && existing.publishedAt === null;
    const isNewPublication = status === ArticleStatus.published && existing.status !== ArticleStatus.published;
    const title = dto.title?.trim() || existing.title;
    const category = dto.category === undefined ? existing.category : dto.category.trim();
    const tags = dto.tags === undefined ? existing.tags : this.normalizeTags(dto.tags);
    const contentFormat = dto.contentFormat === undefined ? existing.contentFormat : (dto.contentFormat === "html" ? ArticleContentFormat.html : ArticleContentFormat.markdown);
    const content = dto.content === undefined ? existing.content : normalizeArticleContent(dto.content, contentFormat);
    const resource = this.resourceSummary(content, contentFormat);
    if (status === ArticleStatus.published && !this.canManageContent(user)) {
      await this.contentModerationService.enforce({ source: "article", actorId: user.id, content: `${title}\n${articleContentToPlainText(content, contentFormat)}`, contentRef: `article:${id}` });
    }
    const article = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.article.update({ where: { id }, data: {
        title,
        summary: dto.summary === undefined ? existing.summary : dto.summary.trim(),
        content,
        contentFormat,
        category,
        tags,
        titleColor: dto.titleColor === undefined ? existing.titleColor : this.normalizeTitleColor(dto.titleColor),
          visibility,
          status,
          scheduledPublishAt: status === ArticleStatus.published ? null : undefined,
          scheduledUnpublishAt: status === ArticleStatus.published ? null : undefined,
          scheduleError: null,
          publicationCount: isNewPublication ? { increment: 1 } : undefined,
        ...resource,
        ...buildSearchFields([title, category, tags]),
        publishedAt:
          status === ArticleStatus.published
            ? existing.publishedAt ?? new Date()
            : status === ArticleStatus.draft || status === ArticleStatus.unpublished
              ? existing.publishedAt
              : existing.publishedAt,
        allowedRoles: {
          deleteMany: {},
          create: roles.map((role) => ({ roleId: role.id })),
        },
      }, include: articleInclude });
      await this.createVersionSnapshot(transaction, updated, user.id, isNewPublication ? ArticleVersionSource.publish : ArticleVersionSource.manual);
      if (isFirstPublication) {
        await this.reputationService.awardArticlePublished(transaction, user.id, updated.id);
        await this.notifySubscribersOfPublication(transaction, updated);
      }
      return updated;
    });
    if (status === ArticleStatus.published && !this.canManageContent(user)) {
      await this.contentModerationService.recordAccepted({ source: "article", actorId: user.id, content: `${title}\n${articleContentToPlainText(content, contentFormat)}`, contentRef: `article:${article.id}` });
    }
    return this.toResponse(article, user);
  }

  async publish(id: number, user: AuthenticatedUser): Promise<ArticleResponse> {
    const existing = await this.getArticleOrThrow(id);
    this.assertCanEdit(existing, user);
    await this.assertArticlePublishAllowed(user);
    if (existing.status === ArticleStatus.blocked || existing.status === ArticleStatus.deleted) {
      throw new BadRequestException("受限或已删除的文章不能直接发布。");
    }
    if (!existing.title.trim() || !existing.content.trim()) {
      throw new BadRequestException("文章标题和正文不能为空。");
    }
    const resource = this.resourceSummary(existing.content, existing.contentFormat);
    if (!this.canManageContent(user)) {
      await this.contentModerationService.enforce({ source: "article", actorId: user.id, content: `${existing.title}\n${articleContentToPlainText(existing.content, existing.contentFormat)}`, contentRef: `article:${id}` });
    }
    const isFirstPublication = existing.publishedAt === null;
    const isNewPublication = existing.status !== ArticleStatus.published;
    const article = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.article.update({
        where: { id },
        data: { status: ArticleStatus.published, publicationCount: isNewPublication ? { increment: 1 } : undefined, publishedAt: existing.publishedAt ?? new Date(), blockedReason: null, scheduledPublishAt: null, scheduledUnpublishAt: null, scheduleError: null, ...resource },
        include: articleInclude,
      });
      await this.createVersionSnapshot(transaction, updated, user.id, isNewPublication ? ArticleVersionSource.publish : ArticleVersionSource.manual);
      if (isFirstPublication) {
        await this.reputationService.awardArticlePublished(transaction, user.id, updated.id);
        await this.notifySubscribersOfPublication(transaction, updated);
      }
      return updated;
    });
    if (!this.canManageContent(user)) {
      await this.contentModerationService.recordAccepted({ source: "article", actorId: user.id, content: `${article.title}\n${articleContentToPlainText(article.content, article.contentFormat)}`, contentRef: `article:${article.id}` });
    }
    return this.toResponse(article, user);
  }

  async unpublish(id: number, user: AuthenticatedUser): Promise<ArticleResponse> {
    const existing = await this.getArticleOrThrow(id);
    this.assertCanEdit(existing, user);
    if (existing.status === ArticleStatus.blocked || existing.status === ArticleStatus.deleted) {
      throw new BadRequestException("受限或已删除的文章不能执行下架操作。");
    }
    const article = await this.prisma.article.update({
      where: { id },
      data: { status: ArticleStatus.unpublished, scheduledPublishAt: null, scheduledUnpublishAt: null, scheduleError: null },
      include: articleInclude,
    });
    return this.toResponse(article, user);
  }

  async delete(id: number, user: AuthenticatedUser): Promise<{ success: true }> {
    const existing = await this.getArticleOrThrow(id);
    this.assertCanEdit(existing, user);
    await this.prisma.article.update({ where: { id }, data: { status: ArticleStatus.deleted, scheduledPublishAt: null, scheduledUnpublishAt: null, scheduleError: null } });
    return { success: true };
  }

  async restore(id: number, user: AuthenticatedUser): Promise<ArticleResponse> {
    const existing = await this.getArticleOrThrow(id);
    this.assertCanEdit(existing, user);
    if (existing.status !== ArticleStatus.deleted) {
      throw new BadRequestException("只有回收站中的文章可以恢复。");
    }
    const article = await this.prisma.article.update({
      where: { id },
      data: {
        status: ArticleStatus.draft,
        isPinned: false,
        pinOrder: 0,
        blockedReason: null,
        scheduledPublishAt: null,
        scheduledUnpublishAt: null,
        scheduleError: null,
      },
      include: articleInclude,
    });
    return this.toResponse(article, user);
  }

  async permanentlyDelete(id: number, user: AuthenticatedUser): Promise<{ success: true }> {
    const existing = await this.getArticleOrThrow(id);
    this.assertCanEdit(existing, user);
    if (existing.status !== ArticleStatus.deleted) {
      throw new BadRequestException("文章需要先移入回收站才能彻底删除。");
    }
    const attachments = this.prisma.articleAttachment
      ? await this.prisma.articleAttachment.findMany({ where: { articleId: id }, select: { storedName: true } })
      : [];
    await this.prisma.article.delete({ where: { id } });
    await Promise.all([
      ...existing.images.map(({ storedName }) => unlink(this.resolveStoredPath(storedName)).catch(() => undefined)),
      ...attachments.map(({ storedName }) => this.chatAttachmentsService?.deleteStoredFiles([storedName]) ?? Promise.resolve()),
    ]);
    return { success: true };
  }

  async uploadAttachments(
    id: number,
    user: AuthenticatedUser,
    files: UploadedChatAttachment[] | undefined,
  ): Promise<{ attachments: ArticleAttachmentResponse[] }> {
    const article = await this.getArticleOrThrow(id);
    this.assertCanEdit(article, user);
    if (!files?.length) throw new BadRequestException("至少需要上传一个文章附件。");
    const existingCount = await this.prisma.articleAttachment.count({ where: { articleId: id } });
    if (existingCount + files.length > 50) {
      await this.chatAttachmentsService?.cleanupUploadedFiles(files);
      throw new BadRequestException("单篇文章最多包含 50 个附件。");
    }
    if (!this.chatAttachmentsService) {
      await this.cleanupUploadedFiles(files);
      throw new BadRequestException("附件功能暂不可用，请稍后重试。");
    }
    let stored: StoredChatAttachmentInfo[] = [];
    try {
      stored = await this.chatAttachmentsService.storeFiles(files);
      const records = await this.prisma.$transaction(
        stored.map((attachment, index) => this.prisma.articleAttachment.create({
          data: {
            articleId: id,
            kind: attachment.kind,
            originalName: attachment.originalName,
            storedName: attachment.storedName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            sortOrder: existingCount + index,
          },
        })),
      );
      return { attachments: records.map((record) => this.toArticleAttachmentResponse(record)) };
    } catch (error) {
      await Promise.all([
        this.chatAttachmentsService.cleanupUploadedFiles(files),
        stored.length ? this.chatAttachmentsService.deleteStoredFiles(stored.map((attachment) => attachment.storedName)) : Promise.resolve(),
      ]);
      throw error;
    }
  }

  async getArticleAttachment(id: number, user: AuthenticatedUser | null): Promise<{
    filePath: string;
    kind: ChatAttachmentKind;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
  }> {
    const attachment = await this.prisma.articleAttachment.findUnique({
      where: { id },
      select: {
        storedName: true,
        kind: true,
        mimeType: true,
        originalName: true,
        sizeBytes: true,
        article: { select: { authorId: true, status: true, visibility: true, allowedRoles: { select: { role: { select: { code: true } } } } } },
      },
    });
    if (!attachment) throw new NotFoundException("附件不存在。");
    this.assertCanRead(attachment.article, user);
    if (!this.chatAttachmentsService) throw new NotFoundException("附件文件不存在。");
    const file = await this.chatAttachmentsService.getStoredFile(attachment.storedName);
    return { ...file, kind: attachment.kind, mimeType: attachment.mimeType, originalName: attachment.originalName, sizeBytes: attachment.sizeBytes };
  }

  async getArticleAttachmentThumbnail(id: number, user: AuthenticatedUser | null): Promise<{ filePath: string; sizeBytes: number }> {
    const attachment = await this.prisma.articleAttachment.findUnique({
      where: { id },
      select: {
        storedName: true,
        kind: true,
        article: { select: { authorId: true, status: true, visibility: true, allowedRoles: { select: { role: { select: { code: true } } } } } },
      },
    });
    if (!attachment || attachment.kind !== ChatAttachmentKind.image) throw new NotFoundException("图片缩略图不存在。");
    this.assertCanRead(attachment.article, user);
    if (!this.chatAttachmentsService) throw new NotFoundException("图片缩略图不存在。");
    return this.chatAttachmentsService.getStoredThumbnail(attachment.storedName);
  }

  private async cleanupUploadedFiles(files: UploadedChatAttachment[]): Promise<void> {
    await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
  }

  async uploadImages(
    id: number,
    user: AuthenticatedUser,
    files: UploadedArticleImage[] | undefined,
  ): Promise<{ images: string[] }> {
    const article = await this.getArticleOrThrow(id);
    this.assertCanEdit(article, user);
    if (!files?.length) {
      throw new BadRequestException("至少需要上传一张文章图片。");
    }
    const publishPolicy = await this.siteSettingsService.getArticlePublishPolicy();
    const maxFileSizeBytes = publishPolicy.articleImageMaxSizeMb * 1024 * 1024;
    const oversizedFile = files.find((file) => file.size > maxFileSizeBytes);
    if (oversizedFile) {
      throw new BadRequestException(`单张图片不能超过 ${publishPolicy.articleImageMaxSizeMb} MB。`);
    }
    const existingCount = await this.prisma.articleImage.count({ where: { articleId: id } });
    if (existingCount + files.length > ARTICLE_IMAGE_MAX_FILES_PER_ARTICLE) {
      throw new BadRequestException(`单篇文章最多上传 ${ARTICLE_IMAGE_MAX_FILES_PER_ARTICLE} 张图片。`);
    }

    const preparedFiles = files.map((file) => {
      const format = this.validateImage(file);
      const storedName = `${randomUUID()}${format.extension}`;
      return { file, format, storedName, filePath: this.resolveStoredPath(storedName) };
    });
    await mkdir(this.uploadDirectory, { recursive: true });
    const writtenFiles: string[] = [];
    try {
      for (const prepared of preparedFiles) {
        await writeFile(prepared.filePath, prepared.file.buffer, { flag: "wx" });
        writtenFiles.push(prepared.filePath);
      }
      const created = await this.prisma.$transaction(async (transaction) => {
        const startOrder = existingCount;
        return Promise.all(
          preparedFiles.map((prepared, index) =>
            transaction.articleImage.create({
              data: {
                articleId: id,
                originalName: basename(prepared.file.originalname).slice(0, 255),
                storedName: prepared.storedName,
                mimeType: prepared.format.mimeType,
                sizeBytes: prepared.file.size,
                sortOrder: startOrder + index,
              },
              select: { storedName: true },
            }),
          ),
        );
      });
      return { images: created.map((image) => `/articles/images/${image.storedName}`) };
    } catch (error) {
      await Promise.all(writtenFiles.map((filePath) => unlink(filePath).catch(() => undefined)));
      throw error;
    }
  }

  async getImage(storedName: string): Promise<{ filePath: string; mimeType: string }> {
    const image = await this.prisma.articleImage.findUnique({ where: { storedName }, select: { mimeType: true } });
    if (!image) {
      throw new NotFoundException("文章图片不存在。");
    }
    const filePath = this.resolveStoredPath(storedName);
    try {
      await access(filePath);
    } catch {
      throw new NotFoundException("文章图片文件不存在。");
    }
    return { filePath, mimeType: image.mimeType };
  }

  async toggleLike(id: number, user: AuthenticatedUser, liked: boolean): Promise<ArticleInteractionResponse> {
    const target = await this.assertArticleInteractionAllowed(id, user);
    const notificationSettings = await this.siteSettingsService.getNotificationSettings();
    const existing = await this.prisma.articleLike.findUnique({ where: { articleId_userId: { articleId: id, userId: user.id } } });
    if (liked && !existing) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.articleLike.create({ data: { articleId: id, userId: user.id } });
        await transaction.article.update({ where: { id }, data: { likeCount: { increment: 1 } } });
        await this.reputationService.awardArticleLiked(transaction, target.authorId, id, user.id);
        if (notificationSettings.notifyArticleLiked && target.authorId !== user.id) {
          await this.createAggregatedArticleNotification(transaction, {
            article: target,
            actor: user,
            recipientId: target.authorId,
            type: UserNotificationType.article_liked,
            verb: "点赞了",
            verbEn: "liked",
            bodyTemplate: notificationSettings.templates.articleLiked,
            bodyTemplateEn: notificationSettings.templatesEn.articleLiked,
          });
        }
      });
    } else if (!liked && existing) {
      await this.prisma.$transaction([
        this.prisma.articleLike.delete({ where: { articleId_userId: { articleId: id, userId: user.id } } }),
        this.prisma.article.update({ where: { id }, data: { likeCount: { decrement: 1 } } }),
      ]);
    }
    const article = await this.prisma.article.findUniqueOrThrow({ where: { id }, select: { likeCount: true, favoriteCount: true } });
    return { liked, likeCount: Math.max(0, article.likeCount), favoriteCount: article.favoriteCount };
  }

  async toggleFavorite(id: number, user: AuthenticatedUser, favorited: boolean): Promise<ArticleInteractionResponse> {
    const target = await this.assertArticleInteractionAllowed(id, user);
    const notificationSettings = await this.siteSettingsService.getNotificationSettings();
    const existing = await this.prisma.articleFavorite.findUnique({ where: { articleId_userId: { articleId: id, userId: user.id } } });
    if (favorited && !existing) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.articleFavorite.create({ data: { articleId: id, userId: user.id } });
        await transaction.article.update({ where: { id }, data: { favoriteCount: { increment: 1 } } });
        if (notificationSettings.notifyArticleFavorited && target.authorId !== user.id) {
          await this.createAggregatedArticleNotification(transaction, {
            article: target,
            actor: user,
            recipientId: target.authorId,
            type: UserNotificationType.article_favorited,
            verb: "收藏了",
            verbEn: "favorited",
            bodyTemplate: notificationSettings.templates.articleFavorited,
            bodyTemplateEn: notificationSettings.templatesEn.articleFavorited,
          });
        }
      });
    } else if (!favorited && existing) {
      await this.prisma.$transaction([
        this.prisma.articleFavorite.delete({ where: { articleId_userId: { articleId: id, userId: user.id } } }),
        this.prisma.article.update({ where: { id }, data: { favoriteCount: { decrement: 1 } } }),
      ]);
    }
    const article = await this.prisma.article.findUniqueOrThrow({ where: { id }, select: { likeCount: true, favoriteCount: true } });
    return { favorited, likeCount: article.likeCount, favoriteCount: Math.max(0, article.favoriteCount) };
  }

  async redeemResource(
    id: number,
    user: AuthenticatedUser,
    dto: RedeemArticleResourceDto,
  ): Promise<ArticleResponse> {
    const article = await this.getArticleOrThrow(id);
    this.assertCanRead(article, user);
    if (article.status !== ArticleStatus.published) throw new BadRequestException("文章当前不能兑换资源。");
    const parsed = parseArticleContent(article.content, article.contentFormat);
    const block = parsed.blocks.find((candidate) => candidate.key === dto.blockKey);
    if (!block) throw new BadRequestException("资源区域不存在或已经更新，请刷新文章后重试。");
    if (article.authorId !== user.id && !this.canManageContent(user)) {
      try {
        await this.prisma.$transaction(async (transaction) => {
          const existing = await transaction.articleResourceExchange.findUnique({
            where: { articleId_buyerId_blockKey: { articleId: id, buyerId: user.id, blockKey: block.key } },
            select: { id: true },
          });
          if (existing) return;
          await transaction.articleResourceExchange.create({
            data: {
              articleId: id,
              buyerId: user.id,
              authorId: article.authorId,
              blockKey: block.key,
              pointCost: block.pointCost,
              sellerAvailableAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
            },
          });
          await this.reputationService.transferResourcePoints(transaction, {
            buyerId: user.id,
            authorId: article.authorId,
            articleId: id,
            blockKey: block.key,
            pointCost: block.pointCost,
          });
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new BadRequestException("该资源已经兑换，无需重复支付。");
        }
        throw error;
      }
    }
    const [refreshed, readerState] = await Promise.all([
      this.getArticleOrThrow(id),
      this.getReaderState(id, user.id),
    ]);
    return this.toResponse(refreshed, user, readerState);
  }

  async toggleReadLater(
    id: number,
    user: AuthenticatedUser,
    readLater: boolean,
  ): Promise<ArticleReadLaterResponse> {
    await this.assertArticleInteractionAllowed(id, user);
    if (readLater) {
      await this.prisma.articleReadLater.upsert({
        where: { articleId_userId: { articleId: id, userId: user.id } },
        create: { articleId: id, userId: user.id },
        update: { createdAt: new Date() },
      });
    } else {
      await this.prisma.articleReadLater.deleteMany({ where: { articleId: id, userId: user.id } });
    }
    return { readLater };
  }

  async updateReadingProgress(
    id: number,
    user: AuthenticatedUser,
    progress: number,
  ): Promise<ReadingProgressResponse> {
    const article = await this.assertArticleInteractionAllowed(id, user);
    if (article.status !== ArticleStatus.published) {
      throw new BadRequestException("文章当前不能记录阅读进度。");
    }
    const lastReadAt = new Date();
    const record = await this.prisma.articleReadingHistory.upsert({
      where: { articleId_userId: { articleId: id, userId: user.id } },
      create: { articleId: id, userId: user.id, progress, lastReadAt },
      update: { progress, lastReadAt },
      select: { progress: true, lastReadAt: true },
    });
    return { progress: record.progress, lastReadAt: record.lastReadAt.toISOString() };
  }

  async removeReadingHistory(id: number, user: AuthenticatedUser): Promise<{ success: true }> {
    await this.prisma.articleReadingHistory.deleteMany({ where: { articleId: id, userId: user.id } });
    return { success: true };
  }

  async clearReadingHistory(user: AuthenticatedUser): Promise<{ count: number }> {
    const result = await this.prisma.articleReadingHistory.deleteMany({ where: { userId: user.id } });
    return { count: result.count };
  }

  async createComment(id: number, user: AuthenticatedUser, dto: CreateArticleCommentDto, files?: UploadedChatAttachment[]): Promise<ArticleCommentResponse> {
    let stored: StoredChatAttachmentInfo[] = [];
    try {
      const [publishPolicy, notificationSettings] = await Promise.all([
        this.siteSettingsService.getArticlePublishPolicy(),
        this.siteSettingsService.getNotificationSettings(),
      ]);
      if (!publishPolicy.commentsEnabled) {
        throw new BadRequestException("评论功能暂未开放。");
      }
      const article = await this.getArticleOrThrow(id);
      this.assertCanRead(article, user);
      const body = dto.body.trim();
      if (!body && !files?.length) {
        throw new BadRequestException("评论内容不能为空。");
      }
      if (body) await this.contentModerationService.enforce({ source: "comment", actorId: user.id, content: body });
      let parent: { id: number; authorId: number } | null = null;
      if (dto.parentId) {
        parent = await this.prisma.articleComment.findFirst({ where: { id: dto.parentId, articleId: id, status: ArticleCommentStatus.active }, select: { id: true, authorId: true } });
        if (!parent) {
          throw new BadRequestException("回复的评论不存在。");
        }
      }
      stored = files?.length ? await this.storeContentFiles(files) : [];
      const comment = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.articleComment.create({
          data: {
            articleId: id,
            authorId: user.id,
            parentId: dto.parentId ?? null,
            body,
            attachments: stored.length ? { create: stored.map((attachment) => ({ ...attachment, ownerId: user.id })) } : undefined,
          },
          select: this.commentSelect(),
        });
        await transaction.article.update({ where: { id }, data: { commentCount: { increment: 1 } } });
        await this.reputationService.awardArticleComment(transaction, user.id, created.id, id);
        const actionUrl = `/articles/${article.slug}?commentId=${created.id}`;
        if (parent) {
          if (notificationSettings.notifyCommentReplied && parent.authorId !== user.id) await transaction.userNotification.create({ data: {
            userId: parent.authorId, actorId: user.id,
            type: UserNotificationType.comment_replied, channel: UserNotificationChannel.interaction,
            title: "评论有了新回复", ...this.siteSettingsService.renderNotificationTemplate(notificationSettings, "commentReplied", {
              actor: user.nickname || user.username,
              article: article.title,
              comment: body,
            }),
            actionUrl, articleId: article.id, commentId: created.id,
          } });
          if (notificationSettings.notifyArticleCommented && article.authorId !== user.id && article.authorId !== parent.authorId) await transaction.userNotification.create({ data: {
            userId: article.authorId, actorId: user.id,
            type: UserNotificationType.article_commented, channel: UserNotificationChannel.interaction,
            title: "文章有了新回复", ...this.siteSettingsService.renderNotificationTemplate(notificationSettings, "articleCommented", {
              actor: user.nickname || user.username,
              article: article.title,
              comment: body,
            }),
            actionUrl, articleId: article.id, commentId: created.id,
          } });
        } else if (notificationSettings.notifyArticleCommented && article.authorId !== user.id) await transaction.userNotification.create({ data: {
          userId: article.authorId, actorId: user.id,
          type: UserNotificationType.article_commented, channel: UserNotificationChannel.interaction,
          title: "文章有了新评论", ...this.siteSettingsService.renderNotificationTemplate(notificationSettings, "articleCommented", {
            actor: user.nickname || user.username,
            article: article.title,
            comment: body,
          }),
          actionUrl, articleId: article.id, commentId: created.id,
        } });
        return created;
      });
      if (body) await this.contentModerationService.recordAccepted({ source: "comment", actorId: user.id, content: body, contentRef: `comment:${comment.id}` });
      return this.toCommentResponse(comment);
    } catch (error) {
      await Promise.all([
        this.chatAttachmentsService?.cleanupUploadedFiles(files),
        stored.length ? this.chatAttachmentsService?.deleteStoredFiles(stored.map((attachment) => attachment.storedName)) : Promise.resolve(),
      ]);
      throw error;
    }
  }

  async deleteComment(id: number, user: AuthenticatedUser): Promise<{ success: true }> {
    const comment = await this.prisma.articleComment.findUnique({ where: { id }, select: { authorId: true, status: true } });
    if (!comment) {
      throw new NotFoundException("评论不存在。");
    }
    if (comment.authorId !== user.id && !this.canManageContent(user)) {
      throw new ForbiddenException("没有删除这条评论的权限。");
    }
    if (comment.status !== ArticleCommentStatus.deleted) {
      await this.prisma.$transaction((transaction) =>
        this.setCommentStatus(transaction, id, ArticleCommentStatus.deleted),
      );
    }
    return { success: true };
  }

  async toggleCommentLike(
    id: number,
    user: AuthenticatedUser,
    liked: boolean,
  ): Promise<{ liked: boolean; likeCount: number }> {
    const comment = await this.prisma.articleComment.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!comment || comment.status !== ArticleCommentStatus.active) {
      throw new NotFoundException("评论不存在或当前不可互动。");
    }
    const existing = await this.prisma.articleCommentLike.findUnique({
      where: { commentId_userId: { commentId: id, userId: user.id } },
      select: { commentId: true },
    });
    if (liked && !existing) {
      await this.prisma.$transaction([
        this.prisma.articleCommentLike.create({ data: { commentId: id, userId: user.id } }),
        this.prisma.articleComment.update({ where: { id }, data: { likeCount: { increment: 1 } } }),
      ]);
    } else if (!liked && existing) {
      await this.prisma.$transaction([
        this.prisma.articleCommentLike.delete({ where: { commentId_userId: { commentId: id, userId: user.id } } }),
        this.prisma.articleComment.update({ where: { id }, data: { likeCount: { decrement: 1 } } }),
      ]);
    }
    const updated = await this.prisma.articleComment.findUniqueOrThrow({ where: { id }, select: { likeCount: true } });
    return { liked, likeCount: Math.max(0, updated.likeCount) };
  }

  async reportComment(
    id: number,
    user: AuthenticatedUser,
    dto: ReportArticleCommentDto,
  ): Promise<{ reported: true }> {
    const publishPolicy = await this.siteSettingsService.getArticlePublishPolicy();
    if (!publishPolicy.reportsEnabled) {
      throw new BadRequestException("举报功能暂未开放。");
    }
    const comment = await this.prisma.articleComment.findUnique({
      where: { id },
      select: { authorId: true, status: true },
    });
    if (!comment || comment.status !== ArticleCommentStatus.active) {
      throw new NotFoundException("评论不存在或当前不可举报。");
    }
    if (comment.authorId === user.id) {
      throw new BadRequestException("不能举报自己的评论。");
    }
    await this.prisma.articleCommentReport.upsert({
      where: { commentId_reporterId: { commentId: id, reporterId: user.id } },
      create: {
        commentId: id,
        reporterId: user.id,
        reason: dto.reason as ArticleCommentReportReason,
        detail: dto.detail?.trim() || null,
      },
      update: {
        reason: dto.reason as ArticleCommentReportReason,
        detail: dto.detail?.trim() || null,
        status: ArticleCommentReportStatus.pending,
        handledById: null,
        handledAt: null,
        resolution: null,
      },
    });
    return { reported: true };
  }

  async reportArticle(
    id: number,
    user: AuthenticatedUser,
    dto: ReportArticleDto,
  ): Promise<{ reported: true }> {
    const publishPolicy = await this.siteSettingsService.getArticlePublishPolicy();
    if (!publishPolicy.reportsEnabled) throw new BadRequestException("举报功能暂未开放。");
    const article = await this.getArticleOrThrow(id);
    this.assertCanRead(article, user);
    if (article.status !== ArticleStatus.published) throw new BadRequestException("文章当前不可举报。");
    if (article.authorId === user.id) throw new BadRequestException("不能举报自己的文章。");

    const publicationNumber = Math.max(1, article.publicationCount);
    const pendingDuplicate = await this.prisma.articleReport.findFirst({
      where: {
        articleId: id,
        publicationNumber,
        reason: dto.reason as ArticleCommentReportReason,
        status: ArticleCommentReportStatus.pending,
      },
      select: { id: true },
    });
    if (pendingDuplicate) {
      throw new BadRequestException("该文章当前发布版本已有相同类型的待处理举报。请等待处理结果。");
    }
    const report = await this.prisma.articleReport.create({
      data: {
        articleId: id,
        reporterId: user.id,
        publicationNumber,
        reason: dto.reason as ArticleCommentReportReason,
        detail: dto.detail?.trim() || null,
      },
      select: { id: true, status: true },
    });
    const notificationSettings = await this.siteSettingsService.getNotificationSettings();
    if (notificationSettings.notifyCommentReport) {
      const administrators = await this.prisma.user.findMany({
        where: { status: "active", OR: [{ isSuperAdmin: true }, { isAdministrator: true }] },
        select: { id: true },
      });
      if (administrators.length) {
        await this.prisma.userNotification.createMany({
          data: administrators.map(({ id: administratorId }) => ({
            userId: administratorId,
            actorId: user.id,
            type: UserNotificationType.article_report_received,
            channel: UserNotificationChannel.system,
            title: "收到文章举报",
            body: `${user.nickname || user.username} 举报了《${article.title}》，请前往文章管理处理。`.slice(0, 500),
            actionUrl: `/admin/articles?tab=articles&report=${report.id}`,
            articleId: article.id,
            articleReportId: report.id,
          })),
        });
      }
    }
    return { reported: true };
  }

  async moderateArticle(id: number, actor: AuthenticatedUser, dto: ModerateArticleDto): Promise<ArticleResponse> {
    this.assertCanManageContent(actor);
    const existing = await this.getArticleOrThrow(id);
    const visibility = dto.visibility ?? existing.visibility;
    const roles = await this.resolveRoles(visibility, dto.roleCodes ?? this.roleCodes(existing));
    const status = dto.status ? this.toArticleStatus(dto.status) : undefined;
    const isFirstPublication = status === ArticleStatus.published && existing.publishedAt === null;
    const isNewPublication = status === ArticleStatus.published && existing.status !== ArticleStatus.published;
    const article = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.article.update({ where: { id }, data: {
        status,
        publicationCount: isNewPublication ? { increment: 1 } : undefined,
        isPinned: dto.isPinned,
        pinOrder: dto.pinOrder,
        titleColor: dto.titleColor === undefined ? undefined : this.normalizeTitleColor(dto.titleColor),
        visibility,
        blockedReason: dto.blockedReason === undefined ? undefined : dto.blockedReason.trim() || null,
        publishedAt: status === ArticleStatus.published ? existing.publishedAt ?? new Date() : undefined,
        allowedRoles: {
          deleteMany: {},
          create: roles.map((role) => ({ roleId: role.id })),
        },
      }, include: articleInclude });
      if (isFirstPublication) await this.notifySubscribersOfPublication(transaction, updated);
      return updated;
    });
    return this.toResponse(article, actor);
  }

  async listAdminComments(articleId: number | undefined): Promise<ArticleCommentsResponse> {
    const comments = await this.prisma.articleComment.findMany({
      where: articleId === undefined ? undefined : { articleId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: this.commentSelect(),
    });
    const reports = comments.length
      ? await this.prisma.articleCommentReport.findMany({
          where: { commentId: { in: comments.map((comment) => comment.id) } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: commentReportInclude,
        })
      : [];
    const reportsByComment = new Map<number, ArticleCommentReportResponse[]>();
    for (const report of reports) {
      const current = reportsByComment.get(report.commentId) ?? [];
      current.push(this.toCommentReportResponse(report));
      reportsByComment.set(report.commentId, current);
    }
    return {
      items: comments.map((comment) => {
        const commentReports = reportsByComment.get(comment.id) ?? [];
        return this.toCommentResponse(comment, {
          reports: commentReports,
          pendingReportCount: commentReports.filter((report) => report.status === ArticleCommentReportStatus.pending).length,
        });
      }),
      hasMore: false,
      nextCursor: null,
      totalThreads: comments.filter((comment) => comment.parentId === null).length,
    };
  }

  async getCommentReportSummary(): Promise<ArticleCommentReportSummaryResponse> {
    return {
      pending: await this.prisma.articleCommentReport.count({
        where: { status: ArticleCommentReportStatus.pending },
      }),
    };
  }

  async listCommentReports(status?: string): Promise<{ items: ArticleCommentReportResponse[] }> {
    const normalizedStatus = status && Object.values(ArticleCommentReportStatus).includes(status as ArticleCommentReportStatus)
      ? status as ArticleCommentReportStatus
      : undefined;
    const reports = await this.prisma.articleCommentReport.findMany({
      where: normalizedStatus ? { status: normalizedStatus } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      include: commentReportInclude,
    });
    return { items: reports.map((report) => this.toCommentReportResponse(report)) };
  }

  async getArticleReportSummary(): Promise<{ pending: number }> {
    return { pending: await this.prisma.articleReport.count({ where: { status: ArticleCommentReportStatus.pending } }) };
  }

  async listArticleReports(status?: string): Promise<{ items: ArticleReportResponse[] }> {
    const normalizedStatus = status && Object.values(ArticleCommentReportStatus).includes(status as ArticleCommentReportStatus)
      ? status as ArticleCommentReportStatus
      : undefined;
    const reports = await this.prisma.articleReport.findMany({
      where: normalizedStatus ? { status: normalizedStatus } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: articleReportInclude,
    });
    return { items: reports.map((report) => this.toArticleReportResponse(report)) };
  }

  async listMyArticleReports(user: AuthenticatedUser): Promise<{ items: ArticleReportResponse[] }> {
    const reports = await this.prisma.articleReport.findMany({
      where: { reporterId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      include: articleReportInclude,
    });
    return { items: reports.map((report) => this.toArticleReportResponse(report)) };
  }

  async getMyArticleReportPreview(id: number, user: AuthenticatedUser): Promise<ArticleResponse> {
    const report = await this.prisma.articleReport.findUnique({
      where: { id },
      select: { articleId: true, reporterId: true },
    });
    if (!report) throw new NotFoundException("举报记录不存在。");
    if (report.reporterId !== user.id && !this.canManageContent(user)) {
      throw new ForbiddenException("没有查看这篇被举报文章的权限。");
    }
    const [article, readerState] = await Promise.all([
      this.getArticleOrThrow(report.articleId),
      this.getReaderState(report.articleId, user.id),
    ]);
    return this.toResponse(article, user, readerState);
  }

  async getAdminArticle(id: number, actor: AuthenticatedUser): Promise<ArticleResponse> {
    const article = await this.prisma.article.findUnique({ where: { id }, include: articleInclude });
    if (!article) {
      throw new NotFoundException("文章不存在。");
    }
    return this.toResponse(article, actor);
  }

  async getCommentAttachment(id: number, user: AuthenticatedUser | null): Promise<{
    filePath: string;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
  }> {
    const attachment = await this.findCommentAttachment(id);
    this.assertCanRead(attachment.comment.article, user);
    const file = await this.chatAttachmentsService?.getStoredFile(attachment.storedName);
    if (!file) throw new NotFoundException("附件文件不存在。");
    return { ...file, mimeType: attachment.mimeType, originalName: attachment.originalName, sizeBytes: attachment.sizeBytes };
  }

  async getCommentAttachmentThumbnail(id: number, user: AuthenticatedUser | null): Promise<{ filePath: string; sizeBytes: number }> {
    const attachment = await this.findCommentAttachment(id);
    if (attachment.kind !== ChatAttachmentKind.image) throw new NotFoundException("图片缩略图不存在。");
    this.assertCanRead(attachment.comment.article, user);
    const file = await this.chatAttachmentsService?.getStoredThumbnail(attachment.storedName);
    if (!file) throw new NotFoundException("图片缩略图不存在。");
    return file;
  }

  private async findCommentAttachment(id: number) {
    const attachment = await this.prisma.articleCommentAttachment.findUnique({
      where: { id },
      select: {
        storedName: true,
        kind: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        comment: { select: { article: { include: articleInclude } } },
      },
    });
    if (!attachment) throw new NotFoundException("附件不存在。");
    return attachment;
  }

  private async storeContentFiles(files: UploadedChatAttachment[]): Promise<StoredChatAttachmentInfo[]> {
    if (!this.chatAttachmentsService) throw new BadRequestException("附件功能暂不可用，请稍后重试。");
    return this.chatAttachmentsService.storeFiles(files);
  }

  async moderateComment(id: number, actor: AuthenticatedUser, dto: ModerateArticleCommentDto): Promise<{ success: true }> {
    this.assertCanManageContent(actor);
    const comment = await this.prisma.articleComment.findUnique({ where: { id }, select: { status: true } });
    if (!comment) {
      throw new NotFoundException("评论不存在。");
    }
    if (comment.status !== dto.status) {
      await this.prisma.$transaction((transaction) =>
        this.setCommentStatus(transaction, id, dto.status as ArticleCommentStatus),
      );
    }
    return { success: true };
  }

  async moderateCommentReport(
    id: number,
    actor: AuthenticatedUser,
    dto: ModerateArticleCommentReportDto,
  ): Promise<{ success: true }> {
    this.assertCanManageContent(actor);
    const notificationSettings = await this.siteSettingsService.getNotificationSettings();
    await this.prisma.$transaction(async (transaction) => {
      const report = await transaction.articleCommentReport.findUnique({
        where: { id },
        select: {
          commentId: true,
          reporterId: true,
          status: true,
          comment: {
            select: {
              authorId: true,
              body: true,
              article: { select: { title: true, slug: true } },
            },
          },
        },
      });
      if (!report) {
        throw new NotFoundException("举报记录不存在。");
      }
      if (report.status !== ArticleCommentReportStatus.pending) {
        throw new BadRequestException("这条举报已经处理，不能重复操作。");
      }
      if (dto.commentStatus) {
        await this.setCommentStatus(transaction, report.commentId, dto.commentStatus as ArticleCommentStatus);
      }
      const updateResult = await transaction.articleCommentReport.updateMany({
        where: { id, status: ArticleCommentReportStatus.pending },
        data: {
          status: dto.status as ArticleCommentReportStatus,
          resolution: dto.resolution?.trim() || null,
          handledById: actor.id,
          handledAt: new Date(),
        },
      });
      if (updateResult.count !== 1) {
        throw new BadRequestException("这条举报已经由其他管理员处理。");
      }
      const resolved = dto.status === "resolved";
      const resolution = dto.resolution?.trim();
      if (notificationSettings.notifyCommentReport) {
        await transaction.userNotification.create({
          data: {
            userId: report.reporterId,
            actorId: null,
            type: resolved
              ? UserNotificationType.comment_report_resolved
              : UserNotificationType.comment_report_rejected,
            title: resolved ? "举报已处理" : "举报已驳回",
            ...(resolution
              ? {
                body: `你对《${report.comment.article.title}》中评论的举报处理结果：${resolution}`.slice(0, 500),
                bodyEn: `Your report of a comment on ${report.comment.article.title} was handled: ${resolution}`.slice(0, 500),
              }
              : this.siteSettingsService.renderNotificationTemplate(
                notificationSettings,
                "commentReportHandled",
                { article: report.comment.article.title, result: resolved ? "处理" : "驳回", comment: report.comment.body },
                { article: report.comment.article.title, result: resolved ? "resolved" : "rejected", comment: report.comment.body },
              )),
            actionUrl: `/articles/${report.comment.article.slug}?commentId=${report.commentId}`,
            commentReportId: id,
          },
        });
      }
      const commentStatus = dto.commentStatus as ArticleCommentStatus | undefined;
      if (
        notificationSettings.notifyCommentReport &&
        report.comment.authorId !== report.reporterId &&
        (commentStatus === ArticleCommentStatus.blocked || commentStatus === ArticleCommentStatus.deleted)
      ) {
        await transaction.userNotification.create({
          data: {
            userId: report.comment.authorId,
            actorId: null,
            type: UserNotificationType.comment_author_moderated,
            title: commentStatus === ArticleCommentStatus.deleted ? "你的评论已被删除" : "你的评论已被屏蔽",
            ...this.siteSettingsService.renderNotificationTemplate(
              notificationSettings,
              "commentAuthorModerated",
              { article: report.comment.article.title, result: commentStatus === ArticleCommentStatus.deleted ? "删除" : "屏蔽", comment: report.comment.body },
              { article: report.comment.article.title, result: commentStatus === ArticleCommentStatus.deleted ? "deleted" : "blocked", comment: report.comment.body },
            ),
            actionUrl: `/articles/${report.comment.article.slug}?commentId=${report.commentId}`,
            commentReportId: id,
          },
        });
      }
    });
    return { success: true };
  }

  async moderateArticleReport(
    id: number,
    actor: AuthenticatedUser,
    dto: ModerateArticleReportDto,
  ): Promise<{ success: true }> {
    this.assertCanManageContent(actor);
    const notificationSettings = await this.siteSettingsService.getNotificationSettings();
    await this.prisma.$transaction(async (transaction) => {
      const report = await transaction.articleReport.findUnique({
        where: { id },
        select: {
          articleId: true,
          reporterId: true,
          status: true,
          article: { select: { authorId: true, title: true, slug: true, status: true } },
        },
      });
      if (!report) throw new NotFoundException("文章举报记录不存在。");
      if (report.status !== ArticleCommentReportStatus.pending) throw new BadRequestException("这条文章举报已经处理，不能重复操作。");
      if (dto.articleStatus) {
        await transaction.article.update({
          where: { id: report.articleId },
          data: {
            status: dto.articleStatus === "blocked" ? ArticleStatus.blocked : ArticleStatus.deleted,
            blockedReason: dto.articleStatus === "blocked" ? dto.resolution?.trim() || "文章举报处理" : null,
          },
        });
      }
      const updated = await transaction.articleReport.updateMany({
        where: { id, status: ArticleCommentReportStatus.pending },
        data: {
          status: dto.status as ArticleCommentReportStatus,
          resolution: dto.resolution?.trim() || null,
          handledById: actor.id,
          handledAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new BadRequestException("这条文章举报已经由其他管理员处理。");
      if (notificationSettings.notifyCommentReport) {
        const resolved = dto.status === "resolved";
        const feedback = dto.resolution?.trim() || `你对《${report.article.title}》的举报已${resolved ? "处理" : "驳回"}。`;
        await transaction.userNotification.create({
          data: {
            userId: report.reporterId,
            actorId: actor.id,
            type: resolved ? UserNotificationType.article_report_resolved : UserNotificationType.article_report_rejected,
            channel: UserNotificationChannel.system,
            title: resolved ? "文章举报已处理" : "文章举报已驳回",
            body: feedback.slice(0, 500),
            bodyEn: (dto.resolution?.trim() || `Your report of ${report.article.title} was ${resolved ? "resolved" : "rejected"}.`).slice(0, 500),
            actionUrl: `/articles/${report.article.slug}`,
            articleId: report.articleId,
            articleReportId: id,
          },
        });
        await transaction.userNotification.create({
          data: {
            userId: report.article.authorId,
            actorId: actor.id,
            type: UserNotificationType.article_author_moderated,
            channel: UserNotificationChannel.system,
            title: dto.articleStatus === "deleted"
              ? "你的文章已删除"
              : dto.articleStatus === "blocked"
                ? "你的文章已屏蔽"
                : "文章举报处理结果",
            body: `《${report.article.title}》的举报处理结果：${feedback}`.slice(0, 500),
            bodyEn: `Report handling result for ${report.article.title}: ${feedback}`.slice(0, 500),
            actionUrl: `/articles/${report.article.slug}`,
            articleId: report.articleId,
            articleReportId: id,
          },
        });
      }
      if (dto.status === "resolved") {
        await this.reputationService.awardArticleReportAccepted(
          transaction,
          report.reporterId,
          report.articleId,
          report.article.authorId,
        );
        await this.ensureAuthorRestriction(transaction, report.article.authorId, id);
      }
    });
    return { success: true };
  }

  async createArticleAppeal(id: number, user: AuthenticatedUser, dto: CreateArticleAppealDto): Promise<ArticleAppealResponse> {
    const article = await this.getArticleOrThrow(id);
    if (article.authorId !== user.id) throw new ForbiddenException("只有文章作者可以申诉。");
    if (article.status !== ArticleStatus.blocked) throw new BadRequestException("只有被屏蔽的文章可以申诉。");
    const pending = await this.prisma.articleAppeal.findFirst({ where: { articleId: id, status: ArticleAppealStatus.pending } });
    if (pending) throw new BadRequestException("这篇文章已有待处理申诉，请等待管理员处理。");
    const appeal = await this.prisma.articleAppeal.create({
      data: { articleId: id, authorId: user.id, reason: dto.reason.trim() },
      include: articleAppealInclude,
    });
    const administrators = await this.prisma.user.findMany({
      where: { status: "active", OR: [{ isSuperAdmin: true }, { isAdministrator: true }] },
      select: { id: true },
    });
    if (administrators.length) {
      await this.prisma.userNotification.createMany({
        data: administrators.map(({ id: administratorId }) => ({
          userId: administratorId,
          actorId: user.id,
          type: UserNotificationType.article_appeal_received,
          channel: UserNotificationChannel.system,
          title: "收到文章申诉",
          body: `${user.nickname || user.username} 申诉了《${article.title}》，请前往文章管理处理。`.slice(0, 500),
          actionUrl: `/admin/articles?tab=articles&appeal=${appeal.id}`,
          articleId: id,
        })),
      });
    }
    return this.toArticleAppealResponse(appeal);
  }

  async listArticleAppeals(status?: string): Promise<{ items: ArticleAppealResponse[] }> {
    const normalized = status && Object.values(ArticleAppealStatus).includes(status as ArticleAppealStatus)
      ? status as ArticleAppealStatus
      : undefined;
    const items = await this.prisma.articleAppeal.findMany({
      where: normalized ? { status: normalized } : undefined,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 200,
      include: articleAppealInclude,
    });
    return { items: items.map((item) => this.toArticleAppealResponse(item)) };
  }

  async moderateArticleAppeal(id: number, actor: AuthenticatedUser, dto: ModerateArticleAppealDto): Promise<{ success: true }> {
    this.assertCanManageContent(actor);
    await this.prisma.$transaction(async (transaction) => {
      const appeal = await transaction.articleAppeal.findUnique({
        where: { id },
        select: { articleId: true, authorId: true, status: true, article: { select: { title: true, slug: true } } },
      });
      if (!appeal) throw new NotFoundException("文章申诉不存在。");
      if (appeal.status !== ArticleAppealStatus.pending) throw new BadRequestException("这条申诉已经处理，不能重复操作。");
      await transaction.articleAppeal.update({
        where: { id },
        data: { status: dto.status as ArticleAppealStatus, resolution: dto.resolution.trim(), reviewedById: actor.id, reviewedAt: new Date() },
      });
      if (dto.status === "approved") {
        await transaction.article.update({
          where: { id: appeal.articleId },
          data: { status: ArticleStatus.unpublished, blockedReason: null },
        });
      }
      await transaction.userNotification.create({
        data: {
          userId: appeal.authorId,
          actorId: actor.id,
          type: UserNotificationType.article_appeal_resolved,
          channel: UserNotificationChannel.system,
          title: dto.status === "approved" ? "文章申诉已通过" : "文章申诉已驳回",
          body: `《${appeal.article.title}》的申诉${dto.status === "approved" ? "已通过，文章已解除屏蔽，请重新发布" : "已驳回"}：${dto.resolution.trim()}`.slice(0, 500),
          actionUrl: `/articles/edit/${appeal.articleId}`,
          articleId: appeal.articleId,
        },
      });
    });
    return { success: true };
  }

  async listViolationAuthors(): Promise<{ items: ViolationAuthorResponse[] }> {
    const reports = await this.prisma.articleReport.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5000,
      select: {
        reporterId: true,
        createdAt: true,
        publicationNumber: true,
        article: { select: { id: true, authorId: true, author: { select: { id: true, nickname: true, username: true, avatarStoredName: true, isSuperAdmin: true, isAdministrator: true, role: { select: { code: true, name: true, level: true } } } } } },
      },
    });
    const activeRestrictions = await this.prisma.articlePublishRestriction.findMany({
      where: { liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, userId: true, reason: true, startsAt: true, endsAt: true, liftedAt: true },
    });
    const byUser = new Map<number, typeof reports[number]["article"]["author"]>();
    for (const report of reports) byUser.set(report.article.authorId, report.article.author);
    for (const restriction of activeRestrictions) {
      if (!byUser.has(restriction.userId)) {
        const user = await this.prisma.user.findUnique({ where: { id: restriction.userId }, select: { id: true, nickname: true, username: true, avatarStoredName: true, isSuperAdmin: true, isAdministrator: true, role: { select: { code: true, name: true, level: true } } } });
        if (user) byUser.set(user.id, user);
      }
    }
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const items = [...byUser.entries()].map(([userId, author]) => {
      const received = reports.filter((report) => report.article.authorId === userId);
      const submitted = reports.filter((report) => report.reporterId === userId);
      const restriction = activeRestrictions.find((item) => item.userId === userId) ?? null;
      return {
        user: this.toAuthor(author),
        totalReceived: countDistinctReportPublications(received, (item) => item.article.id),
        recentReceived: countDistinctReportPublications(received, (item) => item.article.id, cutoff),
        totalSubmitted: submitted.length,
        recentSubmitted: submitted.filter((item) => item.createdAt >= cutoff).length,
        restriction: restriction ? { id: restriction.id, reason: restriction.reason, startsAt: restriction.startsAt.toISOString(), endsAt: restriction.endsAt?.toISOString() ?? null, liftedAt: restriction.liftedAt?.toISOString() ?? null } : null,
      };
    }).sort((a, b) => b.recentReceived - a.recentReceived || b.totalReceived - a.totalReceived);
    return { items };
  }

  async getViolationAuthor(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, username: true, avatarStoredName: true, isSuperAdmin: true, isAdministrator: true, role: { select: { code: true, name: true, level: true } } } });
    if (!user) throw new NotFoundException("用户不存在。");
    const [received, submitted, restriction] = await Promise.all([
      this.prisma.articleReport.findMany({ where: { article: { authorId: userId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 500, include: { article: { select: { id: true, title: true, slug: true } }, reporter: { select: { id: true, nickname: true, username: true, avatarStoredName: true, isSuperAdmin: true, isAdministrator: true, role: { select: { code: true, name: true, level: true } } } } } }),
      this.prisma.articleReport.findMany({ where: { reporterId: userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 500, include: { article: { select: { id: true, title: true, slug: true, author: { select: { id: true, nickname: true, username: true, avatarStoredName: true, isSuperAdmin: true, isAdministrator: true, role: { select: { code: true, name: true, level: true } } } } } } } }),
      this.prisma.articlePublishRestriction.findFirst({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, reason: true, startsAt: true, endsAt: true, liftedAt: true } }),
    ]);
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return {
      user: this.toAuthor(user),
      totalReceived: countDistinctReportPublications(received, (item) => item.article.id),
      recentReceived: countDistinctReportPublications(received, (item) => item.article.id, cutoff),
      totalSubmitted: submitted.length,
      recentSubmitted: submitted.filter((item) => item.createdAt >= cutoff).length,
      restriction: restriction ? { id: restriction.id, reason: restriction.reason, startsAt: restriction.startsAt.toISOString(), endsAt: restriction.endsAt?.toISOString() ?? null, liftedAt: restriction.liftedAt?.toISOString() ?? null } : null,
      received: received.map((item) => ({ id: item.id, publicationNumber: item.publicationNumber, article: item.article, reporter: this.toAuthor(item.reporter), reason: item.reason, detail: item.detail, status: item.status, resolution: item.resolution, createdAt: item.createdAt.toISOString(), handledAt: item.handledAt?.toISOString() ?? null })),
      submitted: submitted.map((item) => ({ id: item.id, publicationNumber: item.publicationNumber, article: item.article, reason: item.reason, detail: item.detail, status: item.status, resolution: item.resolution, createdAt: item.createdAt.toISOString(), handledAt: item.handledAt?.toISOString() ?? null })),
    };
  }

  async updateViolationRestriction(userId: number, actor: AuthenticatedUser, dto: UpdateArticlePublishRestrictionDto) {
    this.assertCanManageContent(actor);
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, username: true } });
    if (!target) throw new NotFoundException("用户不存在。");
    const current = await this.prisma.articlePublishRestriction.findFirst({ where: { userId, liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (dto.active === false) {
      if (current) await this.prisma.articlePublishRestriction.update({ where: { id: current.id }, data: { liftedAt: new Date(), liftedById: actor.id } });
      return { success: true, active: false };
    }
    const endsAt = dto.permanent ? null : dto.endsAt ? new Date(dto.endsAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    if (endsAt && Number.isNaN(endsAt.getTime())) throw new BadRequestException("限制结束时间无效。");
    if (endsAt && endsAt <= new Date()) throw new BadRequestException("限制结束时间必须晚于当前时间。");
    if (current) {
      await this.prisma.articlePublishRestriction.update({ where: { id: current.id }, data: { endsAt, reason: dto.reason?.trim() || current.reason } });
    } else {
      await this.prisma.articlePublishRestriction.create({ data: { userId, createdById: actor.id, reason: dto.reason?.trim() || "管理员手动限制文章发布", endsAt } });
    }
    await this.prisma.userNotification.create({ data: { userId, actorId: actor.id, type: UserNotificationType.article_publish_restricted, channel: UserNotificationChannel.system, title: "文章发布权限已更新", body: endsAt ? `管理员已限制你发布文章至 ${endsAt.toLocaleString("zh-CN") }。` : "管理员已永久限制你发布文章。", actionUrl: "/articles/mine" } });
    return { success: true, active: true, endsAt: endsAt?.toISOString() ?? null };
  }

  private async listArticles(
    query: ListArticlesQueryDto,
    user: AuthenticatedUser | null,
    admin: boolean,
    mine = false,
  ): Promise<ArticleListResponse> {
    if (!admin && !mine && query.sort === "recommended") {
      return this.listRecommendedArticles(query, user);
    }
    const where = this.buildWhere(query, user, admin, mine);
    const total = await this.prisma.article.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const items = await this.prisma.article.findMany({
      where,
      orderBy: this.orderBy(query, admin),
      skip: (page - 1) * query.pageSize,
      take: query.pageSize,
      include: articleInclude,
    });
    return {
      items: items.map((article) => this.toResponse(article, user)),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  private async listArticlesByWhere(query: ListArticlesQueryDto, user: AuthenticatedUser, where: Prisma.ArticleWhereInput): Promise<ArticleListResponse> {
    const total = await this.prisma.article.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const items = await this.prisma.article.findMany({
      where, orderBy: this.orderBy(query, false), skip: (page - 1) * query.pageSize,
      take: query.pageSize, include: articleInclude,
    });
    return { items: items.map((article) => this.toResponse(article, user)), total, page, pageSize: query.pageSize, totalPages };
  }

  private async listInteractedArticles(
    query: ListArticlesQueryDto,
    user: AuthenticatedUser,
    interaction: "favorite" | "like",
  ): Promise<ArticleListResponse> {
    const articleWhere = this.buildWhere(query, user, false, false);
    const relationWhere = { userId: user.id, article: articleWhere };
    const total = interaction === "favorite"
      ? await this.prisma.articleFavorite.count({ where: relationWhere })
      : await this.prisma.articleLike.count({ where: relationWhere });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const articles: ArticleRecord[] = interaction === "favorite"
      ? (await this.prisma.articleFavorite.findMany({
          where: relationWhere,
          orderBy: [{ createdAt: "desc" }],
          skip: (page - 1) * query.pageSize,
          take: query.pageSize,
          select: { article: { include: articleInclude } },
        })).map(({ article }) => article)
      : (await this.prisma.articleLike.findMany({
          where: relationWhere,
          orderBy: [{ createdAt: "desc" }],
          skip: (page - 1) * query.pageSize,
          take: query.pageSize,
          select: { article: { include: articleInclude } },
        })).map(({ article }) => article);
    return {
      items: articles.map((article) => this.toResponse(article, user)),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  private async listRecommendedArticles(
    query: ListArticlesQueryDto,
    user: AuthenticatedUser | null,
  ): Promise<ArticleListResponse> {
    const baseWhere = this.buildWhere(query, user, false, false);
    const feedback = user ? await this.prisma.recommendationFeedback.findMany({
      where: { userId: user.id },
      select: { targetType: true, targetId: true, updatedAt: true },
    }) : [];
    const feedbackIds = (targetType: RecommendationTargetType) => feedback
      .filter((record) => record.targetType === targetType)
      .map((record) => record.targetId);
    const ignoredArticleIds = feedbackIds(RecommendationTargetType.article);
    const ignoredAuthorIds = feedbackIds(RecommendationTargetType.author);
    const ignoredTopicIds = feedbackIds(RecommendationTargetType.topic);
    const ignoredCollectionIds = feedbackIds(RecommendationTargetType.collection);
    const exclusions: Prisma.ArticleWhereInput[] = [
      ...(ignoredArticleIds.length ? [{ id: { notIn: ignoredArticleIds } }] : []),
      ...(ignoredAuthorIds.length ? [{ authorId: { notIn: ignoredAuthorIds } }] : []),
      ...(ignoredTopicIds.length ? [{ topicItems: { none: { topicId: { in: ignoredTopicIds } } } }] : []),
      ...(ignoredCollectionIds.length ? [{ collectionItems: { none: { collectionId: { in: ignoredCollectionIds } } } }] : []),
    ];
    const where: Prisma.ArticleWhereInput = exclusions.length
      ? { AND: [baseWhere, ...exclusions] }
      : baseWhere;
    const feedbackVersion = feedback
      .map((record) => `${record.targetType}:${record.targetId}:${record.updatedAt.getTime()}`)
      .sort()
      .join("|");
    const cacheKey = this.recommendationCacheKey(query, user, feedbackVersion);
    let rankedIds: number[] | null = null;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as unknown;
        if (Array.isArray(parsed)) {
          rankedIds = parsed.filter((value): value is number => Number.isInteger(value));
        }
      }
    } catch {
      // Recommendation remains available when Redis is temporarily unavailable.
    }

    if (!rankedIds) {
      const candidateSelect = {
        id: true,
        authorId: true,
        category: true,
        tags: true,
        isPinned: true,
        publishedAt: true,
        viewCount: true,
        likeCount: true,
        favoriteCount: true,
        commentCount: true,
      } satisfies Prisma.ArticleSelect;
      const [latest, popular, preferences] = await Promise.all([
        this.prisma.article.findMany({
          where,
          orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
          take: 300,
          select: candidateSelect,
        }),
        this.prisma.article.findMany({
          where,
          orderBy: [
            { favoriteCount: "desc" },
            { likeCount: "desc" },
            { commentCount: "desc" },
            { viewCount: "desc" },
          ],
          take: 300,
          select: candidateSelect,
        }),
        this.recommendationPreferences(user),
      ]);
      const candidates = new Map<number, RecommendationCandidate>();
      for (const candidate of [...latest, ...popular]) {
        if (candidates.size >= 500 && !candidates.has(candidate.id)) continue;
        candidates.set(candidate.id, candidate);
      }
      const now = Date.now();
      rankedIds = [...candidates.values()]
        .map((candidate) => ({
          id: candidate.id,
          score: this.recommendationScore(candidate, preferences, now),
          publishedAt: candidate.publishedAt?.getTime() ?? 0,
        }))
        .sort((left, right) => right.score - left.score || right.publishedAt - left.publishedAt || right.id - left.id)
        .map(({ id }) => id);
      try {
        await this.redis.set(cacheKey, JSON.stringify(rankedIds), 300);
      } catch {
        // Database-derived ranking is the fallback, so cache writes are optional.
      }
    }

    if (rankedIds.length) {
      const visibleIds = await this.prisma.article.findMany({
        where: { AND: [where, { id: { in: rankedIds } }] },
        select: { id: true },
      });
      const visibleIdSet = new Set(visibleIds.map(({ id }) => id));
      rankedIds = rankedIds.filter((id) => visibleIdSet.has(id));
    }

    const total = rankedIds.length;
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const pageIds = rankedIds.slice((page - 1) * query.pageSize, page * query.pageSize);
    const records = pageIds.length ? await this.prisma.article.findMany({
      where: { AND: [where, { id: { in: pageIds } }] },
      include: articleInclude,
    }) : [];
    const recordsById = new Map(records.map((record) => [record.id, record]));
    return {
      items: pageIds.flatMap((id) => {
        const article = recordsById.get(id);
        return article ? [this.toResponse(article, user)] : [];
      }),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  private async recommendationPreferences(user: AuthenticatedUser | null): Promise<{
    categoryWeights: Map<string, number>;
    tagWeights: Map<string, number>;
    subscribedAuthorIds: Set<number>;
    seen: Map<number, number>;
  }> {
    const categoryWeights = new Map<string, number>();
    const tagWeights = new Map<string, number>();
    const subscribedAuthorIds = new Set<number>();
    const seen = new Map<number, number>();
    if (!user) return { categoryWeights, tagWeights, subscribedAuthorIds, seen };

    const articleSelect = { id: true, category: true, tags: true } satisfies Prisma.ArticleSelect;
    const [history, likes, favorites, readLater, subscriptions] = await Promise.all([
      this.prisma.articleReadingHistory.findMany({
        where: { userId: user.id },
        orderBy: [{ lastReadAt: "desc" }],
        take: 120,
        select: { progress: true, article: { select: articleSelect } },
      }),
      this.prisma.articleLike.findMany({
        where: { userId: user.id },
        orderBy: [{ createdAt: "desc" }],
        take: 100,
        select: { article: { select: articleSelect } },
      }),
      this.prisma.articleFavorite.findMany({
        where: { userId: user.id },
        orderBy: [{ createdAt: "desc" }],
        take: 100,
        select: { article: { select: articleSelect } },
      }),
      this.prisma.articleReadLater.findMany({
        where: { userId: user.id },
        orderBy: [{ createdAt: "desc" }],
        take: 100,
        select: { article: { select: articleSelect } },
      }),
      this.prisma.userSubscription.findMany({
        where: { subscriberId: user.id },
        select: { authorId: true },
      }),
    ]);

    const absorb = (article: { category: string; tags: string }, weight: number) => {
      if (article.category) categoryWeights.set(article.category, (categoryWeights.get(article.category) ?? 0) + weight);
      for (const tag of article.tags.split(",").filter(Boolean)) {
        tagWeights.set(tag, (tagWeights.get(tag) ?? 0) + weight);
      }
    };
    for (const record of history) {
      seen.set(record.article.id, record.progress);
      absorb(record.article, 1);
    }
    for (const record of likes) absorb(record.article, 3);
    for (const record of favorites) absorb(record.article, 4);
    for (const record of readLater) absorb(record.article, 2);
    for (const record of subscriptions) subscribedAuthorIds.add(record.authorId);
    return { categoryWeights, tagWeights, subscribedAuthorIds, seen };
  }

  private recommendationScore(
    candidate: RecommendationCandidate,
    preferences: Awaited<ReturnType<ArticlesService["recommendationPreferences"]>>,
    now: number,
  ): number {
    const ageDays = candidate.publishedAt
      ? Math.max(0, (now - candidate.publishedAt.getTime()) / 86_400_000)
      : 365;
    const recency = Math.max(0, 32 - ageDays) * 1.35;
    const engagement = Math.log2(candidate.viewCount + 1) * 1.8
      + candidate.likeCount * 4
      + candidate.favoriteCount * 5
      + candidate.commentCount * 6;
    const category = Math.min(24, (preferences.categoryWeights.get(candidate.category) ?? 0) * 2.5);
    const tags = candidate.tags.split(",").filter(Boolean)
      .reduce((sum, tag) => sum + Math.min(8, (preferences.tagWeights.get(tag) ?? 0) * 1.3), 0);
    const subscription = preferences.subscribedAuthorIds.has(candidate.authorId) ? 28 : 0;
    const progress = preferences.seen.get(candidate.id);
    const seenPenalty = progress === undefined ? -8 : Math.min(22, 6 + progress / 5);
    return engagement + recency + category + tags + subscription + (candidate.isPinned ? 6 : 0) - seenPenalty;
  }

  private recommendationCacheKey(
    query: ListArticlesQueryDto,
    user: AuthenticatedUser | null,
    feedbackVersion = "",
  ): string {
    const context = JSON.stringify({
      userId: user?.id ?? 0,
      role: user?.role.code ?? "public",
      superAdmin: user?.isSuperAdmin ?? false,
      search: query.search?.trim() ?? "",
      category: query.category?.trim() ?? "",
      feedbackVersion,
    });
    return `articles:recommendations:${createHash("sha256").update(context).digest("hex").slice(0, 24)}`;
  }

  private buildWhere(
    query: ListArticlesQueryDto,
    user: AuthenticatedUser | null,
    admin: boolean,
    mine: boolean,
  ): Prisma.ArticleWhereInput {
    const search = query.search?.trim();
    const where: Prisma.ArticleWhereInput = {};
    if (admin) {
      if (query.status) where.status = this.toArticleStatus(query.status);
    } else if (mine && user) {
      where.authorId = user.id;
      const mineStatus = query.status ? this.toArticleStatus(query.status) : null;
      where.status = mineStatus ?? { not: ArticleStatus.deleted };
      if (mineStatus === ArticleStatus.draft) {
        where.AND = [
          { scheduledPublishAt: null },
          { scheduledUnpublishAt: null },
          { scheduleError: null },
        ];
      }
    } else {
      where.status = ArticleStatus.published;
      if (!user) {
        where.visibility = ArticleVisibility.public;
      } else if (!user.isSuperAdmin) {
        where.OR = [
          { visibility: ArticleVisibility.public },
          { visibility: ArticleVisibility.authenticated },
          { visibility: ArticleVisibility.private, authorId: user.id },
          { visibility: ArticleVisibility.role_restricted, allowedRoles: { some: { role: { code: user.role.code } } } },
        ];
      }
    }
    if (query.category) where.category = query.category.trim();
    if (query.authorUsername) where.author = { is: { username: query.authorUsername.trim() } };
    if (query.sort === "pinned") where.isPinned = true;
    if (search) {
      const searchCondition: Prisma.ArticleWhereInput = {
        OR: [
          { title: { contains: search } },
          { summary: { contains: search } },
          { content: { contains: search } },
          { category: { contains: search } },
          { tags: { contains: search } },
          { author: { is: { nickname: { contains: search } } } },
          { author: { is: { username: { contains: search } } } },
        ],
      };
      if (where.AND) {
        where.AND = Array.isArray(where.AND) ? [...where.AND, searchCondition] : [where.AND, searchCondition];
      } else {
        where.AND = [searchCondition];
      }
    }
    return where;
  }

  private orderBy(query: ListArticlesQueryDto, admin: boolean): Prisma.ArticleOrderByWithRelationInput[] {
    if (query.sort === "popular") return [
      { favoriteCount: "desc" },
      { likeCount: "desc" },
      { commentCount: "desc" },
      { viewCount: "desc" },
      { publishedAt: "desc" },
      { id: "desc" },
    ];
    if (query.sort === "views") return [{ viewCount: "desc" }, { publishedAt: "desc" }, { id: "desc" }];
    if (query.sort === "likes") return [{ likeCount: "desc" }, { publishedAt: "desc" }, { id: "desc" }];
    if (query.sort === "favorites") return [{ favoriteCount: "desc" }, { publishedAt: "desc" }, { id: "desc" }];
    if (query.sort === "comments") return [{ commentCount: "desc" }, { publishedAt: "desc" }, { id: "desc" }];
    if (query.sort === "pinned") return [{ pinOrder: "asc" }, { publishedAt: "desc" }, { id: "desc" }];
    return admin
      ? [{ isPinned: "desc" }, { pinOrder: "asc" }, { updatedAt: "desc" }, { id: "desc" }]
      : [{ isPinned: "desc" }, { pinOrder: "asc" }, { publishedAt: "desc" }, { id: "desc" }];
  }

  private async getBySlug(slug: string, user: AuthenticatedUser | null, visitorKey: string): Promise<ArticleResponse> {
    const article = await this.getArticleBySlug(slug);
    this.assertCanRead(article, user);
    if (article.status === ArticleStatus.published) {
      await Promise.all([
        this.recordView(article.id, user?.id ?? null, visitorKey),
        user ? this.touchReadingHistory(article.id, user.id) : Promise.resolve(),
      ]);
    }
    const [refreshed, readerState] = await Promise.all([
      this.getArticleOrThrow(article.id),
      user ? this.getReaderState(article.id, user.id) : Promise.resolve(undefined),
    ]);
    return this.toResponse(refreshed, user, readerState);
  }

  private async getArticleBySlug(slug: string): Promise<ArticleRecord> {
    const article = await this.prisma.article.findUnique({ where: { slug }, include: articleInclude });
    if (!article) throw new NotFoundException("文章不存在。");
    return article;
  }

  private async getArticleOrThrow(id: number): Promise<ArticleRecord> {
    const article = await this.prisma.article.findUnique({ where: { id }, include: articleInclude });
    if (!article) throw new NotFoundException("文章不存在。");
    return article;
  }

  private assertCanRead(article: {
    status: ArticleStatus;
    authorId: number;
    visibility: ArticleVisibility;
    allowedRoles: Array<{ role: { code: string } }>;
  }, user: AuthenticatedUser | null): void {
    if (article.status !== ArticleStatus.published) {
      if (!user || (!this.canManageContent(user) && article.authorId !== user.id)) {
        throw new NotFoundException("文章不存在。");
      }
      return;
    }
    if (user?.isSuperAdmin || article.visibility === ArticleVisibility.public) return;
    if (!user) throw new ForbiddenException("请登录后阅读这篇文章。");
    if (article.visibility === ArticleVisibility.authenticated) return;
    if (article.visibility === ArticleVisibility.private && article.authorId === user.id) return;
    if (article.visibility === ArticleVisibility.role_restricted && article.allowedRoles.some(({ role }) => role.code === user.role.code)) return;
    throw new ForbiddenException("当前账号没有阅读这篇文章的权限。");
  }

  private assertCanEdit(article: ArticleRecord, user: AuthenticatedUser): void {
    if (article.authorId !== user.id && !this.canManageContent(user)) {
      throw new ForbiddenException("没有编辑这篇文章的权限。");
    }
  }

  private async assertArticleInteractionAllowed(id: number, user: AuthenticatedUser): Promise<ArticleRecord> {
    const article = await this.getArticleOrThrow(id);
    this.assertCanRead(article, user);
    if (article.status !== ArticleStatus.published) throw new BadRequestException("文章当前不能互动。");
    return article;
  }

  private async createAggregatedArticleNotification(transaction: Prisma.TransactionClient, input: {
    article: ArticleRecord;
    actor: AuthenticatedUser;
    recipientId: number;
    type: "article_liked" | "article_favorited";
    verb: "点赞了" | "收藏了";
    verbEn: "liked" | "favorited";
    bodyTemplate: string;
    bodyTemplateEn: string;
  }): Promise<void> {
    const existing = await transaction.userNotification.findFirst({
      where: { userId: input.recipientId, type: input.type, articleId: input.article.id, readAt: null },
      select: { id: true, aggregateCount: true },
    });
    if (existing) await transaction.userNotification.delete({ where: { id: existing.id } });
    const aggregateCount = (existing?.aggregateCount ?? 0) + 1;
    const actorName = input.actor.nickname || input.actor.username;
    const renderedBody = this.siteSettingsService.renderTemplate(input.bodyTemplate, {
      actor: actorName,
      article: input.article.title,
      count: aggregateCount,
    });
    const renderedBodyEn = this.siteSettingsService.renderTemplate(input.bodyTemplateEn, {
      actor: actorName,
      article: input.article.title,
      count: aggregateCount,
    });
    await transaction.userNotification.create({ data: {
      userId: input.recipientId, actorId: input.actor.id, type: input.type,
      channel: UserNotificationChannel.interaction,
      title: input.type === UserNotificationType.article_liked ? "文章收到点赞" : "文章被收藏",
      body: aggregateCount > 1 ? `${actorName} 等 ${aggregateCount} 人${input.verb}《${input.article.title}》。` : renderedBody,
      bodyEn: aggregateCount > 1 ? `${actorName} and ${aggregateCount - 1} others ${input.verbEn} ${input.article.title}.` : renderedBodyEn,
      actionUrl: `/articles/${input.article.slug}`, articleId: input.article.id, aggregateCount,
    } });
  }

  private async notifySubscribersOfPublication(transaction: Prisma.TransactionClient, article: ArticleRecord): Promise<void> {
    if (article.visibility === ArticleVisibility.private) return;
    const notificationSettings = await this.siteSettingsService.getNotificationSettings();
    if (!notificationSettings.notifySubscriptionPublished) return;
    const roleCodes = article.allowedRoles.map(({ role }) => role.code);
    const subscriptions = await transaction.userSubscription.findMany({ where: {
      authorId: article.authorId,
      notifyNewArticles: true,
      subscriber: {
        status: "active",
        ...(article.visibility === ArticleVisibility.role_restricted ? { role: { code: { in: roleCodes } } } : {}),
      },
    }, select: { subscriberId: true } });
    if (!subscriptions.length) return;
    await transaction.userNotification.createMany({ data: subscriptions.map(({ subscriberId }) => ({
      userId: subscriberId, actorId: article.authorId,
      type: UserNotificationType.subscription_published, channel: UserNotificationChannel.subscription,
      title: "订阅作者发布了新内容", ...this.siteSettingsService.renderNotificationTemplate(notificationSettings, "subscriptionPublished", {
        author: article.author.nickname || article.author.username,
        article: article.title,
      }),
      actionUrl: `/articles/${article.slug}`, articleId: article.id,
    })) });
  }

  private canManageContent(user: AuthenticatedUser): boolean {
    return user.isSuperAdmin || Boolean(user.isAdministrator);
  }

  private async scheduledAuthor(userId: number): Promise<Pick<AuthenticatedUser, "id" | "isSuperAdmin" | "isAdministrator"> | null> {
    return this.prisma.user.findUnique({ where: { id: userId, status: "active" }, select: { id: true, isSuperAdmin: true, isAdministrator: true } });
  }

  private async publishCheckFor(
    article: ArticleRecord,
    user: Pick<AuthenticatedUser, "id" | "isSuperAdmin" | "isAdministrator">,
  ): Promise<ArticlePublishCheckResponse> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!article.title.trim()) errors.push("文章标题不能为空。");
    if (!article.content.trim()) errors.push("文章正文不能为空。");
    if (article.status === ArticleStatus.blocked) errors.push("受限文章需要管理员解除限制后才能发布。");
    if (article.status === ArticleStatus.deleted) errors.push("回收站中的文章不能发布。");
    if (!this.canManageContent(user as AuthenticatedUser)) {
      const restriction = await this.prisma.articlePublishRestriction?.findFirst({
        where: { userId: user.id, liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
        select: { endsAt: true },
      });
      if (restriction) errors.push(restriction.endsAt ? `当前账号被限制发布文章至 ${restriction.endsAt.toLocaleString("zh-CN")}。` : "当前账号被永久限制发布文章。");
    }
    if (parseArticleContent(article.content, article.contentFormat).blocks.length) warnings.push("文章包含局部积分资源，发布后读者需要按区块兑换。");
    warnings.push("发布时仍会再次执行敏感词、重复内容和链接频率检查。");
    return { valid: errors.length === 0, errors, warnings };
  }

  private async normalizeTemplateInput(dto: ArticleTemplateDto) {
    const name = dto.name.trim();
    const contentFormat = dto.contentFormat === "html" ? ArticleContentFormat.html : ArticleContentFormat.markdown;
    const content = normalizeArticleContent(dto.content, contentFormat);
    if (!name || !content) throw new BadRequestException("模板名称和正文不能为空。");
    const visibility = dto.visibility ?? ArticleVisibility.public;
    const roles = await this.resolveRoles(visibility, dto.roleCodes ?? []);
    return {
      title: dto.title?.trim() ?? "",
      name,
      summary: dto.summary?.trim() ?? "",
      content,
      contentFormat,
      category: dto.category?.trim() ?? "",
      tags: this.normalizeTags(dto.tags),
      titleColor: this.normalizeTitleColor(dto.titleColor),
      visibility,
      roleCodes: roles.map((role) => role.code).join(","),
    };
  }

  private rethrowTemplatePersistenceError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BadRequestException("该模板名称已经存在，请换一个名称。");
    }
    throw error;
  }

  private toTemplateResponse(template: {
    id: number;
    name: string;
    title: string;
    summary: string;
    content: string;
    contentFormat: ArticleContentFormat;
    category: string;
    tags: string;
    titleColor: string;
    visibility: ArticleVisibility;
    roleCodes: string;
    createdAt: Date;
    updatedAt: Date;
  }): ArticleTemplateResponse {
    return {
      id: template.id,
      name: template.name,
      title: template.title,
      summary: template.summary,
      content: template.content,
      contentFormat: template.contentFormat,
      category: template.category,
      tags: template.tags.split(",").filter(Boolean),
      titleColor: template.titleColor,
      visibility: template.visibility,
      roleCodes: template.roleCodes.split(",").filter(Boolean),
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }

  private parseScheduleDate(value: string | null | undefined, label: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${label}时间无效。`);
    return parsed;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private assertCanManageContent(user: AuthenticatedUser): void {
    if (!this.canManageContent(user)) throw new ForbiddenException("需要管理员权限。");
  }

  private normalizeAuthorStatus(status: ArticleStatusValue | undefined): ArticleStatus {
    const normalized = status ?? ArticleStatus.draft;
    if (![ArticleStatus.draft, ArticleStatus.published, ArticleStatus.unpublished].includes(normalized as "draft" | "published" | "unpublished")) {
      throw new BadRequestException("普通用户只能保存草稿、发布或下架文章。");
    }
    return this.toArticleStatus(normalized);
  }

  private toArticleStatus(status: ArticleStatusValue): ArticleStatus {
    if (!ARTICLE_STATUSES.includes(status)) throw new BadRequestException("文章状态无效。");
    return status as ArticleStatus;
  }

  private normalizeTags(tags: string | undefined): string {
    return [...new Set((tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 12).join(",");
  }

  private normalizeTitleColor(color: string | undefined): string {
    const normalized = color?.trim() ?? "";
    if (normalized && !/^#[0-9a-f]{6}$/i.test(normalized)) throw new BadRequestException("标题颜色必须是六位十六进制颜色。");
    return normalized;
  }

  private async assertArticlePublishAllowed(user: AuthenticatedUser): Promise<void> {
    if (this.canManageContent(user)) return;
    const restriction = await this.prisma.articlePublishRestriction?.findFirst({
      where: { userId: user.id, liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { endsAt: true },
    });
    if (!restriction) return;
    throw new BadRequestException(restriction.endsAt
      ? `当前账号被限制发布文章至 ${restriction.endsAt.toLocaleString("zh-CN")}，可以继续保存文章。`
      : "当前账号被永久限制发布文章，可以继续保存文章。");
  }

  private async resolveRoles(visibility: ArticleVisibility | string, roleCodes: string[]) {
    const normalizedCodes = [...new Set(roleCodes.map((code) => code.trim()).filter(Boolean))];
    if (visibility !== ArticleVisibility.role_restricted) return [];
    if (!normalizedCodes.length) throw new BadRequestException("指定角色可见时至少需要选择一个角色。");
    const roles = await this.prisma.role.findMany({ where: { code: { in: normalizedCodes } }, select: { id: true, code: true } });
    if (roles.length !== normalizedCodes.length) throw new BadRequestException("选择的角色不存在。");
    return roles;
  }

  private roleCodes(article: ArticleRecord): string[] {
    return article.allowedRoles.map(({ role }) => role.code);
  }

  private async createUniqueSlug(title: string): Promise<string> {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "article";
    return `${base}-${randomUUID().slice(0, 8)}`;
  }

  /** Keeps article search/filter metadata in step with the resource-block grammar. */
  private resourceSummary(content: string, contentFormat: ArticleContentFormat = ArticleContentFormat.markdown): { isPointResource: boolean; pointCost: number } {
    const blocks = parseArticleContent(content, contentFormat).blocks;
    return {
      isPointResource: blocks.length > 0,
      pointCost: blocks.length ? Math.min(...blocks.map((block) => block.pointCost)) : 0,
    };
  }

  private async recordView(articleId: number, userId: number | null, visitorKey: string): Promise<void> {
    const viewedOn = new Date().toISOString().slice(0, 10);
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.articleView.create({ data: { articleId, userId, visitorKey, viewedOn } });
        await transaction.article.update({ where: { id: articleId }, data: { viewCount: { increment: 1 } } });
        if (userId) await this.reputationService.awardArticleRead(transaction, userId, articleId);
      });
    } catch {
      // A unique key means the same visitor has already counted today's view.
    }
  }

  private async touchReadingHistory(articleId: number, userId: number): Promise<void> {
    const lastReadAt = new Date();
    await this.prisma.articleReadingHistory.upsert({
      where: { articleId_userId: { articleId, userId } },
      create: { articleId, userId, progress: 1, lastReadAt },
      update: { lastReadAt },
    });
  }

  private async getReaderState(articleId: number, userId: number): Promise<ArticleReaderState> {
    const [readLater, history, exchange] = await Promise.all([
      this.prisma.articleReadLater.findUnique({
        where: { articleId_userId: { articleId, userId } },
        select: { articleId: true },
      }),
      this.prisma.articleReadingHistory.findUnique({
        where: { articleId_userId: { articleId, userId } },
        select: { progress: true, lastReadAt: true },
      }),
      this.prisma.articleResourceExchange.findMany({
        where: { articleId, buyerId: userId },
        select: { blockKey: true },
      }),
    ]);
    return {
      readLater: Boolean(readLater),
      readingProgress: history?.progress ?? null,
      lastReadAt: history?.lastReadAt ?? null,
      unlockedResourceKeys: new Set(exchange.map(({ blockKey }) => blockKey)),
    };
  }

  private validateImage(file: UploadedArticleImage): SupportedArticleImageFormat {
    const mimeType = file.mimetype.toLowerCase();
    const extension = extname(file.originalname).toLowerCase();
    const format = ARTICLE_IMAGE_FORMATS.find((candidate) => candidate.matches(file.buffer));
    if (!format || mimeType !== format.mimeType || !format.extensions.includes(extension)) {
      throw new BadRequestException("只支持有效的 JPEG、PNG、WebP 或 AVIF 图片。");
    }
    return format;
  }

  private resolveStoredPath(storedName: string): string {
    if (!/^[0-9a-f-]{36}\.(?:jpg|png|webp|avif)$/i.test(storedName)) throw new NotFoundException("文章图片不存在。");
    const filePath = resolve(this.uploadDirectory, storedName);
    const prefix = `${this.uploadDirectory}${process.platform === "win32" ? "\\" : "/"}`;
    if (!filePath.startsWith(prefix)) throw new NotFoundException("文章图片不存在。");
    return filePath;
  }

  private async createVersionSnapshot(
    transaction: Prisma.TransactionClient,
    article: ArticleRecord,
    editorId: number,
    source: ArticleVersionSource,
  ): Promise<void> {
    const roleCodes = this.roleCodes(article).join(",");
    const snapshot = {
      title: article.title,
      summary: article.summary,
      content: article.content,
      contentFormat: article.contentFormat,
      category: article.category,
      tags: article.tags,
      titleColor: article.titleColor,
      visibility: article.visibility,
      status: article.status,
      roleCodes,
      isPointResource: article.isPointResource,
      pointCost: article.pointCost,
    };
    const contentHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    const latest = await transaction.articleVersion.findFirst({
      where: { articleId: article.id },
      orderBy: { versionNumber: "desc" },
      select: {
        versionNumber: true,
        contentHash: true,
        title: true,
        summary: true,
        content: true,
        contentFormat: true,
        category: true,
        tags: true,
        titleColor: true,
        visibility: true,
        status: true,
        roleCodes: true,
        isPointResource: true,
        pointCost: true,
      },
    });
    if (latest?.contentHash === contentHash) return;
    const changedFields = latest
      ? ARTICLE_VERSION_FIELDS.filter((field) => latest[field] !== snapshot[field])
      : [...ARTICLE_VERSION_FIELDS];
    await transaction.articleVersion.create({
      data: {
        articleId: article.id,
        editorId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        source,
        ...snapshot,
        contentHash,
        changedFields,
      },
    });
    if (source !== ArticleVersionSource.autosave) return;
    const expired = await transaction.articleVersion.findMany({
      where: { articleId: article.id, source: ArticleVersionSource.autosave },
      orderBy: { versionNumber: "desc" },
      skip: ARTICLE_AUTOSAVE_VERSION_LIMIT,
      select: { id: true },
    });
    if (expired.length) {
      await transaction.articleVersion.deleteMany({ where: { id: { in: expired.map(({ id }) => id) } } });
    }
  }

  private toVersionSummary(version: {
    id: number;
    versionNumber: number;
    source: ArticleVersionSource;
    changedFields: Prisma.JsonValue;
    editor: { id: number; username: string; nickname: string } | null;
    createdAt: Date;
  }): ArticleVersionSummaryResponse {
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      source: version.source,
      changedFields: Array.isArray(version.changedFields)
        ? version.changedFields.filter((field): field is string => typeof field === "string")
        : [],
      editor: version.editor,
      createdAt: version.createdAt.toISOString(),
    };
  }

  private toVersionResponse(version: {
    id: number;
    versionNumber: number;
    source: ArticleVersionSource;
    changedFields: Prisma.JsonValue;
    editor: { id: number; username: string; nickname: string } | null;
    createdAt: Date;
    title: string;
    summary: string;
    content: string;
    contentFormat: ArticleContentFormat;
    category: string;
    tags: string;
    titleColor: string;
    visibility: ArticleVisibility;
    status: ArticleStatus;
    roleCodes: string;
    isPointResource: boolean;
    pointCost: number;
  }): ArticleVersionResponse {
    return {
      ...this.toVersionSummary(version),
      title: version.title,
      summary: version.summary,
      content: version.content,
      contentFormat: version.contentFormat,
      category: version.category,
      tags: version.tags.split(",").filter(Boolean),
      titleColor: version.titleColor,
      visibility: version.visibility,
      status: version.status,
      roleCodes: version.roleCodes.split(",").filter(Boolean),
      isPointResource: version.isPointResource,
      pointCost: version.pointCost,
    };
  }

  private toResponse(
    article: ArticleRecord,
    viewer?: AuthenticatedUser | null,
    readerState?: ArticleReaderState,
  ): ArticleResponse {
    const recentCommenters: ArticleAuthorResponse[] = [];
    const commenterIds = new Set<number>();
    for (const comment of article.comments) {
      if (commenterIds.has(comment.authorId)) continue;
      commenterIds.add(comment.authorId);
      recentCommenters.push(this.toAuthor(comment.author));
      if (recentCommenters.length === 5) break;
    }
    const parsedContent = parseArticleContent(article.content, article.contentFormat);
    const fullContentAccess = Boolean(viewer && (viewer.id === article.authorId || this.canManageContent(viewer)));
    const unlockedKeys = fullContentAccess
      ? new Set(parsedContent.blocks.map((block) => block.key))
      : readerState?.unlockedResourceKeys ?? new Set<string>();
    const contentSegments = parsedContent.segments.map((segment) => {
      if (segment.type === "markdown" || segment.type === "html") return { type: segment.type, content: segment.content };
      const unlocked = unlockedKeys.has(segment.key);
      return unlocked
        ? { type: "resource" as const, key: segment.key, pointCost: segment.pointCost, unlocked: true, content: segment.content }
        : { type: "resource" as const, key: segment.key, pointCost: segment.pointCost, unlocked: false };
    });
    const publicContent = parsedContent.segments
      .filter((segment): segment is Extract<typeof segment, { type: "markdown" | "html" }> => segment.type === "markdown" || segment.type === "html")
      .map((segment) => segment.content)
      .join("\n\n");
    return {
      id: article.id,
      title: article.title,
      slug: article.slug,
      summary: article.summary,
      content: fullContentAccess ? article.content : publicContent,
      contentFormat: article.contentFormat,
      contentSegments,
      coverPath: article.coverPath,
      category: article.category,
      tags: article.tags ? article.tags.split(",").filter(Boolean) : [],
      titleColor: article.titleColor,
      visibility: article.visibility,
      status: article.status,
      isPinned: article.isPinned,
      pinOrder: article.pinOrder,
      publishedAt: article.publishedAt?.toISOString() ?? null,
      schedule: {
        publishAt: article.scheduledPublishAt?.toISOString() ?? null,
        unpublishAt: article.scheduledUnpublishAt?.toISOString() ?? null,
        error: article.scheduleError ?? null,
      },
      blockedReason: article.blockedReason,
      viewCount: article.viewCount,
      likeCount: article.likeCount,
      favoriteCount: article.favoriteCount,
      commentCount: article.commentCount,
      resource: {
        enabled: parsedContent.blocks.length > 0,
        blocks: parsedContent.blocks.map((block) => ({
          key: block.key,
          pointCost: block.pointCost,
          unlocked: unlockedKeys.has(block.key),
        })),
      },
      author: this.toAuthor(article.author),
      recentCommenters,
      allowedRoles: article.allowedRoles.map(({ role }) => role),
      collections: (article.collectionItems ?? [])
        .filter(({ collection }) => (
          collection.visibility === ArticleVisibility.public ||
          viewer?.isSuperAdmin ||
          (viewer && collection.visibility === ArticleVisibility.authenticated) ||
          viewer?.id === collection.ownerId
        ))
        .map(({ collection }) => ({
          id: collection.id,
          label: collection.name,
          href: `/collections/${collection.id}`,
        })),
      topics: (article.topicItems ?? [])
        .filter(({ topic }) => {
          if (viewer?.isSuperAdmin) return true;
          if (topic.status !== ArticleTopicStatus.active) return false;
          if (topic.visibility === PortalVisibility.public) return true;
          if (!viewer) return false;
          if (topic.visibility === PortalVisibility.authenticated) return true;
          return topic.allowedRoles.some(({ role }) => role.code === viewer.role.code);
        })
        .map(({ topic }) => ({
          id: topic.id,
          label: topic.title,
          href: `/topics/${topic.slug}`,
        })),
      images: article.images.map((image) => `/articles/images/${image.storedName}`),
      liked: Boolean(viewer && article.likes.some((like) => like.userId === viewer.id)),
      favorited: Boolean(viewer && article.favorites.some((favorite) => favorite.userId === viewer.id)),
      readLater: readerState?.readLater ?? false,
      readingProgress: readerState?.readingProgress ?? null,
      lastReadAt: readerState?.lastReadAt?.toISOString() ?? null,
      createdAt: article.createdAt.toISOString(),
      updatedAt: article.updatedAt.toISOString(),
    };
  }

  private toArticleAttachmentResponse(attachment: {
    id: number;
    kind: ChatAttachmentKind;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }): ArticleAttachmentResponse {
    return {
      id: attachment.id,
      kind: attachment.kind,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      downloadUrl: `/articles/attachments/${attachment.id}/download`,
      thumbnailUrl: attachment.kind === ChatAttachmentKind.image ? `/articles/attachments/${attachment.id}/thumbnail` : null,
      createdAt: attachment.createdAt.toISOString(),
    };
  }

  private commentSelect() {
    return {
      id: true,
      articleId: true,
      parentId: true,
      body: true,
      status: true,
      likeCount: true,
      createdAt: true,
      updatedAt: true,
      attachments: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          kind: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      },
      author: {
        select: {
          id: true,
          nickname: true,
          username: true,
          avatarStoredName: true,
          isSuperAdmin: true,
          isAdministrator: true,
          role: { select: { code: true, name: true, level: true } },
        },
      },
    } satisfies Prisma.ArticleCommentSelect;
  }

  private toCommentResponse(comment: {
    id: number;
    articleId: number;
    parentId: number | null;
    body: string;
    status?: ArticleCommentStatus;
    likeCount: number;
    createdAt: Date;
    updatedAt: Date;
    attachments?: Array<{
      id: number;
      kind: ChatAttachmentKind;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      createdAt: Date;
    }>;
    author: {
      id: number;
      nickname: string;
      username: string;
      avatarStoredName: string | null;
      isSuperAdmin: boolean;
      isAdministrator: boolean;
      role: { code: string; name: string; level: number };
    };
  }, options: {
    liked?: boolean;
    reported?: boolean;
    pendingReportCount?: number;
    reports?: ArticleCommentReportResponse[];
    sanitizeHiddenBody?: boolean;
  } = {}): ArticleCommentResponse {
    const status = comment.status ?? ArticleCommentStatus.active;
    const body = options.sanitizeHiddenBody && status !== ArticleCommentStatus.active
      ? status === ArticleCommentStatus.deleted ? "该评论已删除" : "该评论已被屏蔽"
      : comment.body;
    return {
      id: comment.id,
      articleId: comment.articleId,
      parentId: comment.parentId,
      body,
      status,
      likeCount: Math.max(0, comment.likeCount),
      liked: options.liked ?? false,
      reported: options.reported ?? false,
      attachments: (comment.attachments ?? []).map((attachment) => this.toCommentAttachmentResponse(attachment)),
      pendingReportCount: options.pendingReportCount,
      reports: options.reports,
      author: this.toAuthor(comment.author),
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
    };
  }

  private toCommentReportResponse(report: CommentReportRecord): ArticleCommentReportResponse {
    return {
      id: report.id,
      commentId: report.commentId,
      commentBody: report.comment.body,
      commentStatus: report.comment.status,
      attachments: (report.comment.attachments ?? []).map((attachment) => this.toCommentAttachmentResponse(attachment)),
      article: report.comment.article,
      reporter: this.toAuthor(report.reporter),
      reason: report.reason,
      detail: report.detail,
      status: report.status,
      resolution: report.resolution,
      createdAt: report.createdAt.toISOString(),
      handledAt: report.handledAt?.toISOString() ?? null,
    };
  }

  private toCommentAttachmentResponse(attachment: {
    id: number;
    kind: ChatAttachmentKind;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }): ArticleCommentAttachmentResponse {
    return {
      id: attachment.id,
      kind: attachment.kind,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      downloadUrl: `/articles/comment-attachments/${attachment.id}/download`,
      thumbnailUrl: attachment.kind === ChatAttachmentKind.image ? `/articles/comment-attachments/${attachment.id}/thumbnail` : null,
      createdAt: attachment.createdAt.toISOString(),
    };
  }

  private toArticleReportResponse(report: ArticleReportRecord): ArticleReportResponse {
    return {
      id: report.id,
      publicationNumber: report.publicationNumber,
      article: report.article,
      reporter: this.toAuthor(report.reporter),
      reason: report.reason,
      detail: report.detail,
      status: report.status,
      resolution: report.resolution,
      createdAt: report.createdAt.toISOString(),
      handledAt: report.handledAt?.toISOString() ?? null,
    };
  }

  private toArticleAppealResponse(appeal: ArticleAppealRecord): ArticleAppealResponse {
    return {
      id: appeal.id,
      article: appeal.article,
      author: this.toAuthor(appeal.author),
      reason: appeal.reason,
      status: appeal.status,
      resolution: appeal.resolution,
      createdAt: appeal.createdAt.toISOString(),
      reviewedAt: appeal.reviewedAt?.toISOString() ?? null,
    };
  }

  private async ensureAuthorRestriction(
    transaction: Prisma.TransactionClient,
    authorId: number,
    sourceReportId: number,
  ): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const validReports = await transaction.articleReport.findMany({
      where: { status: ArticleCommentReportStatus.resolved, createdAt: { gte: cutoff }, article: { authorId } },
      select: { articleId: true, publicationNumber: true, createdAt: true },
    });
    const validCount = countDistinctReportPublications(validReports, (report) => report.articleId);
    if (validCount < 3) return;
    const now = new Date();
    const active = await transaction.articlePublishRestriction.findFirst({
      where: { userId: authorId, liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      select: { id: true },
    });
    if (active) return;
    const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await transaction.articlePublishRestriction.create({
      data: {
        userId: authorId,
        sourceReportId,
        reason: "最近 30 天内有效文章举报达到 3 次，系统自动限制发布。",
        startsAt: now,
        endsAt,
      },
    });
    await transaction.userNotification.create({
      data: {
        userId: authorId,
        actorId: null,
        type: UserNotificationType.article_publish_restricted,
        channel: UserNotificationChannel.system,
        title: "文章发布权限已限制",
        body: `你最近 30 天内有 ${validCount} 次有效文章举报，系统已限制发布文章至 ${endsAt.toLocaleString("zh-CN")}。你仍可以保存修改。`,
        actionUrl: "/articles/mine",
      },
    });
  }

  private visibleCommentIds(comments: Array<{
    id: number;
    parentId: number | null;
    status: ArticleCommentStatus;
  }>): Set<number> {
    const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
    const included = new Set<number>();
    for (const comment of comments) {
      if (comment.status !== ArticleCommentStatus.active) continue;
      let current: typeof comment | undefined = comment;
      const visited = new Set<number>();
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        included.add(current.id);
        current = current.parentId ? commentsById.get(current.parentId) : undefined;
      }
    }
    return included;
  }

  private commentThreadRootId(
    commentId: number,
    commentsById: Map<number, { id: number; parentId: number | null }>,
  ): number {
    let current = commentsById.get(commentId);
    const visited = new Set<number>();
    while (current?.parentId && !visited.has(current.id)) {
      visited.add(current.id);
      current = commentsById.get(current.parentId);
    }
    return current?.id ?? commentId;
  }

  private async setCommentStatus(
    transaction: Prisma.TransactionClient,
    id: number,
    status: ArticleCommentStatus,
  ): Promise<void> {
    const comment = await transaction.articleComment.update({
      where: { id },
      data: { status },
      select: { articleId: true },
    });
    const activeCount = await transaction.articleComment.count({
      where: { articleId: comment.articleId, status: ArticleCommentStatus.active },
    });
    await transaction.article.update({
      where: { id: comment.articleId },
      data: { commentCount: activeCount },
    });
  }

  private toAuthor(author: {
    id: number;
    nickname: string;
    username: string;
    avatarStoredName: string | null;
    isSuperAdmin: boolean;
    isAdministrator: boolean;
    role: { code: string; name: string; level: number };
  }): ArticleAuthorResponse {
    const deleted = author.username.startsWith("deleted-");
    return {
      id: author.id,
      nickname: deleted ? "已注销用户" : (author.nickname || author.username),
      username: deleted ? "deleted-user" : author.username,
      avatarUrl: deleted ? null : (author.avatarStoredName ? `/auth/avatars/${author.avatarStoredName}` : null),
      isSuperAdmin: deleted ? false : author.isSuperAdmin,
      isAdministrator: deleted ? false : author.isAdministrator,
      isDeleted: deleted,
      role: {
        code: author.role.code,
        name: author.role.name,
        level: author.role.level,
      },
    };
  }

  createVisitorKey(userAgent: string, ip: string, userId?: number): string {
    if (userId) return `user:${userId}`;
    return createHash("sha256").update(`${ip}|${userAgent}`).digest("hex");
  }
}
