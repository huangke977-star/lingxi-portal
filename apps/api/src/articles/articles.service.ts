import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
  ArticleCommentReportReason,
  ArticleCommentReportStatus,
  ArticleCommentStatus,
  ArticleStatus,
  ArticleTopicStatus,
  ArticleVersionSource,
  ArticleVisibility,
  PortalVisibility,
  Prisma,
  UserNotificationChannel,
  UserNotificationType,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { buildSearchFields } from "../search/search-normalization";
import { SiteSettingsService } from "../site-settings/site-settings.service";
import {
  ARTICLE_STATUSES,
  ArticleStatusValue,
  AutosaveArticleDto,
  CreateArticleCommentDto,
  CreateArticleDto,
  ListArticleCommentsQueryDto,
  ListArticlesQueryDto,
  ModerateArticleCommentDto,
  ModerateArticleCommentReportDto,
  ModerateArticleDto,
  ReportArticleCommentDto,
  UpdateArticleDto,
} from "./dto/article.dto";
import {
  ArticleAuthorResponse,
  ArticleCenterSummaryResponse,
  ArticleCommentResponse,
  ArticleCommentReportResponse,
  ArticleCommentReportSummaryResponse,
  ArticleCommentsResponse,
  ArticleInteractionResponse,
  ArticleListResponse,
  ArticleMineSummaryResponse,
  ArticleResponse,
  ArticleReadLaterResponse,
  ArticleVersionResponse,
  ArticleVersionSummaryResponse,
  ReadingProgressResponse,
} from "./articles.types";

export const ARTICLE_IMAGE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const ARTICLE_IMAGE_MAX_FILES_PER_ARTICLE = 20;

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

const ARTICLE_VERSION_FIELDS = [
  "title",
  "summary",
  "content",
  "category",
  "tags",
  "titleColor",
  "visibility",
  "status",
  "roleCodes",
] as const;

const articleInclude = {
  author: {
    select: {
      id: true,
      nickname: true,
      username: true,
      avatarStoredName: true,
      isSuperAdmin: true,
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
      role: { select: { code: true, name: true, level: true } },
    },
  },
} satisfies Prisma.ArticleCommentReportInclude;

type CommentReportRecord = Prisma.ArticleCommentReportGetPayload<{
  include: typeof commentReportInclude;
}>;

@Injectable()
export class ArticlesService {
  private readonly uploadDirectory = resolve(
    process.env.ARTICLE_UPLOAD_DIR ?? join(process.cwd(), "uploads", "articles"),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly siteSettingsService: SiteSettingsService,
    private readonly redis: RedisService,
  ) {}

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
    const canManage = Boolean(user?.isSuperAdmin || (user?.role.level ?? 0) >= 90);
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
      })),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  async getMineSummary(user: AuthenticatedUser): Promise<ArticleMineSummaryResponse> {
    const grouped = await this.prisma.article.groupBy({
      by: ["status"],
      where: { authorId: user.id },
      _count: { _all: true },
    });
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
    return summary;
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
    const content = dto.content.trim();
    if (!title || !content) {
      throw new BadRequestException("文章标题和正文不能为空。");
    }

    const visibility = dto.visibility ?? publishPolicy.defaultArticleVisibility;
    const roles = await this.resolveRoles(visibility, dto.roleCodes ?? []);
    const status = this.normalizeAuthorStatus(dto.status);
    const slug = await this.createUniqueSlug(title);
    const tags = this.normalizeTags(dto.tags);
    const article = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.article.create({ data: {
        authorId: user.id,
        title,
        slug,
        summary: dto.summary?.trim() ?? "",
        content,
        category: dto.category?.trim() ?? "",
        tags,
        titleColor: this.normalizeTitleColor(dto.titleColor),
        visibility,
        status,
        publishedAt: status === ArticleStatus.published ? new Date() : null,
        ...buildSearchFields([title, dto.category?.trim() ?? "", tags]),
        allowedRoles: { create: roles.map((role) => ({ roleId: role.id })) },
      }, include: articleInclude });
      await this.createVersionSnapshot(transaction, created, user.id, ArticleVersionSource.manual);
      if (status === ArticleStatus.published) await this.notifySubscribersOfPublication(transaction, created);
      return created;
    });
    return this.toResponse(article, user);
  }

  async createAutosave(user: AuthenticatedUser, dto: AutosaveArticleDto): Promise<ArticleResponse> {
    const publishPolicy = await this.siteSettingsService.getArticlePublishPolicy();
    const title = dto.title?.trim() ?? "";
    const category = dto.category?.trim() ?? "";
    const tags = this.normalizeTags(dto.tags);
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
          content: dto.content ?? "",
          category,
          tags,
          titleColor: this.normalizeTitleColor(dto.titleColor),
          visibility,
          status: ArticleStatus.draft,
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
    const content = dto.content === undefined ? existing.content : dto.content;
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
          category,
          tags,
          titleColor: dto.titleColor === undefined ? existing.titleColor : this.normalizeTitleColor(dto.titleColor),
          visibility,
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
    const restoredStatus = existing.status === ArticleStatus.blocked ? ArticleStatus.blocked : ArticleStatus.draft;
    const article = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.article.update({
        where: { id },
        data: {
          title: version.title,
          summary: version.summary,
          content: version.content,
          category: version.category,
          tags: version.tags,
          titleColor: version.titleColor,
          visibility: version.visibility,
          status: restoredStatus,
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
    const isFirstPublication = status === ArticleStatus.published && existing.publishedAt === null;
    const title = dto.title?.trim() || existing.title;
    const category = dto.category === undefined ? existing.category : dto.category.trim();
    const tags = dto.tags === undefined ? existing.tags : this.normalizeTags(dto.tags);
    const article = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.article.update({ where: { id }, data: {
        title,
        summary: dto.summary === undefined ? existing.summary : dto.summary.trim(),
        content: dto.content === undefined ? existing.content : dto.content.trim(),
        category,
        tags,
        titleColor: dto.titleColor === undefined ? existing.titleColor : this.normalizeTitleColor(dto.titleColor),
        visibility,
        status,
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
      await this.createVersionSnapshot(transaction, updated, user.id, ArticleVersionSource.manual);
      if (isFirstPublication) await this.notifySubscribersOfPublication(transaction, updated);
      return updated;
    });
    return this.toResponse(article, user);
  }

  async publish(id: number, user: AuthenticatedUser): Promise<ArticleResponse> {
    const existing = await this.getArticleOrThrow(id);
    this.assertCanEdit(existing, user);
    if (existing.status === ArticleStatus.blocked || existing.status === ArticleStatus.deleted) {
      throw new BadRequestException("受限或已删除的文章不能直接发布。");
    }
    if (!existing.title.trim() || !existing.content.trim()) {
      throw new BadRequestException("文章标题和正文不能为空。");
    }
    const isFirstPublication = existing.publishedAt === null;
    const article = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.article.update({
        where: { id },
        data: { status: ArticleStatus.published, publishedAt: existing.publishedAt ?? new Date(), blockedReason: null },
        include: articleInclude,
      });
      await this.createVersionSnapshot(transaction, updated, user.id, ArticleVersionSource.publish);
      if (isFirstPublication) await this.notifySubscribersOfPublication(transaction, updated);
      return updated;
    });
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
      data: { status: ArticleStatus.unpublished },
      include: articleInclude,
    });
    return this.toResponse(article, user);
  }

  async delete(id: number, user: AuthenticatedUser): Promise<{ success: true }> {
    const existing = await this.getArticleOrThrow(id);
    this.assertCanEdit(existing, user);
    await this.prisma.article.update({ where: { id }, data: { status: ArticleStatus.deleted } });
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
    await this.prisma.article.delete({ where: { id } });
    await Promise.all(
      existing.images.map(({ storedName }) =>
        unlink(this.resolveStoredPath(storedName)).catch(() => undefined),
      ),
    );
    return { success: true };
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
        if (notificationSettings.notifyArticleLiked && target.authorId !== user.id) {
          await this.createAggregatedArticleNotification(transaction, {
            article: target,
            actor: user,
            recipientId: target.authorId,
            type: UserNotificationType.article_liked,
            verb: "点赞了",
            bodyTemplate: notificationSettings.templates.articleLiked,
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
            bodyTemplate: notificationSettings.templates.articleFavorited,
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

  async createComment(id: number, user: AuthenticatedUser, dto: CreateArticleCommentDto): Promise<ArticleCommentResponse> {
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
    if (!body) {
      throw new BadRequestException("评论内容不能为空。");
    }
    let parent: { id: number; authorId: number } | null = null;
    if (dto.parentId) {
      parent = await this.prisma.articleComment.findFirst({ where: { id: dto.parentId, articleId: id, status: ArticleCommentStatus.active }, select: { id: true, authorId: true } });
      if (!parent) {
        throw new BadRequestException("回复的评论不存在。");
      }
    }
    const comment = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.articleComment.create({
        data: { articleId: id, authorId: user.id, parentId: dto.parentId ?? null, body },
        select: this.commentSelect(),
      });
      await transaction.article.update({ where: { id }, data: { commentCount: { increment: 1 } } });
      const actionUrl = `/articles/${article.slug}?commentId=${created.id}`;
      if (parent) {
        if (notificationSettings.notifyCommentReplied && parent.authorId !== user.id) await transaction.userNotification.create({ data: {
          userId: parent.authorId, actorId: user.id,
          type: UserNotificationType.comment_replied, channel: UserNotificationChannel.interaction,
          title: "评论有了新回复", body: this.siteSettingsService.renderTemplate(notificationSettings.templates.commentReplied, {
            actor: user.nickname || user.username,
            article: article.title,
            comment: body,
          }),
          actionUrl, articleId: article.id, commentId: created.id,
        } });
        if (notificationSettings.notifyArticleCommented && article.authorId !== user.id && article.authorId !== parent.authorId) await transaction.userNotification.create({ data: {
          userId: article.authorId, actorId: user.id,
          type: UserNotificationType.article_commented, channel: UserNotificationChannel.interaction,
          title: "文章有了新回复", body: this.siteSettingsService.renderTemplate(notificationSettings.templates.articleCommented, {
            actor: user.nickname || user.username,
            article: article.title,
            comment: body,
          }),
          actionUrl, articleId: article.id, commentId: created.id,
        } });
      } else if (notificationSettings.notifyArticleCommented && article.authorId !== user.id) await transaction.userNotification.create({ data: {
        userId: article.authorId, actorId: user.id,
        type: UserNotificationType.article_commented, channel: UserNotificationChannel.interaction,
        title: "文章有了新评论", body: this.siteSettingsService.renderTemplate(notificationSettings.templates.articleCommented, {
          actor: user.nickname || user.username,
          article: article.title,
          comment: body,
        }),
        actionUrl, articleId: article.id, commentId: created.id,
      } });
      return created;
    });
    return this.toCommentResponse(comment);
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

  async moderateArticle(id: number, actor: AuthenticatedUser, dto: ModerateArticleDto): Promise<ArticleResponse> {
    this.assertCanManageContent(actor);
    const existing = await this.getArticleOrThrow(id);
    const visibility = dto.visibility ?? existing.visibility;
    const roles = await this.resolveRoles(visibility, dto.roleCodes ?? this.roleCodes(existing));
    const status = dto.status ? this.toArticleStatus(dto.status) : undefined;
    const isFirstPublication = status === ArticleStatus.published && existing.publishedAt === null;
    const article = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.article.update({ where: { id }, data: {
        status,
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

  async getAdminArticle(id: number): Promise<ArticleResponse> {
    const article = await this.prisma.article.findUnique({ where: { id }, include: articleInclude });
    if (!article) {
      throw new NotFoundException("文章不存在。");
    }
    return this.toResponse(article);
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
            body: (resolution
              ? `你对《${report.comment.article.title}》中评论的举报处理结果：${resolution}`
              : this.siteSettingsService.renderTemplate(notificationSettings.templates.commentReportHandled, {
                article: report.comment.article.title,
                result: resolved ? "处理" : "驳回",
                comment: report.comment.body,
              })).slice(0, 500),
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
            body: this.siteSettingsService.renderTemplate(notificationSettings.templates.commentAuthorModerated, {
              article: report.comment.article.title,
              result: commentStatus === ArticleCommentStatus.deleted ? "删除" : "屏蔽",
              comment: report.comment.body,
            }),
            actionUrl: `/articles/${report.comment.article.slug}?commentId=${report.commentId}`,
            commentReportId: id,
          },
        });
      }
    });
    return { success: true };
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
    const where = this.buildWhere(query, user, false, false);
    const cacheKey = this.recommendationCacheKey(query, user);
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

  private recommendationCacheKey(query: ListArticlesQueryDto, user: AuthenticatedUser | null): string {
    const context = JSON.stringify({
      userId: user?.id ?? 0,
      role: user?.role.code ?? "public",
      superAdmin: user?.isSuperAdmin ?? false,
      search: query.search?.trim() ?? "",
      category: query.category?.trim() ?? "",
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
      where.status = query.status ? this.toArticleStatus(query.status) : { not: ArticleStatus.deleted };
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
      where.AND = [{
        OR: [
          { title: { contains: search } },
          { summary: { contains: search } },
          { content: { contains: search } },
          { category: { contains: search } },
          { tags: { contains: search } },
          { author: { is: { nickname: { contains: search } } } },
          { author: { is: { username: { contains: search } } } },
        ],
      }];
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

  private assertCanRead(article: ArticleRecord, user: AuthenticatedUser | null): void {
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
    bodyTemplate: string;
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
    await transaction.userNotification.create({ data: {
      userId: input.recipientId, actorId: input.actor.id, type: input.type,
      channel: UserNotificationChannel.interaction,
      title: input.type === UserNotificationType.article_liked ? "文章收到点赞" : "文章被收藏",
      body: aggregateCount > 1 ? `${actorName} 等 ${aggregateCount} 人${input.verb}《${input.article.title}》。` : renderedBody,
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
      title: "订阅作者发布了新内容", body: this.siteSettingsService.renderTemplate(notificationSettings.templates.subscriptionPublished, {
        author: article.author.nickname || article.author.username,
        article: article.title,
      }),
      actionUrl: `/articles/${article.slug}`, articleId: article.id,
    })) });
  }

  private canManageContent(user: AuthenticatedUser): boolean {
    return user.isSuperAdmin || user.role.level >= 90;
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

  private async recordView(articleId: number, userId: number | null, visitorKey: string): Promise<void> {
    const viewedOn = new Date().toISOString().slice(0, 10);
    try {
      await this.prisma.articleView.create({ data: { articleId, userId, visitorKey, viewedOn } });
      await this.prisma.article.update({ where: { id: articleId }, data: { viewCount: { increment: 1 } } });
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
    const [readLater, history] = await Promise.all([
      this.prisma.articleReadLater.findUnique({
        where: { articleId_userId: { articleId, userId } },
        select: { articleId: true },
      }),
      this.prisma.articleReadingHistory.findUnique({
        where: { articleId_userId: { articleId, userId } },
        select: { progress: true, lastReadAt: true },
      }),
    ]);
    return {
      readLater: Boolean(readLater),
      readingProgress: history?.progress ?? null,
      lastReadAt: history?.lastReadAt ?? null,
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
      category: article.category,
      tags: article.tags,
      titleColor: article.titleColor,
      visibility: article.visibility,
      status: article.status,
      roleCodes,
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
        category: true,
        tags: true,
        titleColor: true,
        visibility: true,
        status: true,
        roleCodes: true,
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
    category: string;
    tags: string;
    titleColor: string;
    visibility: ArticleVisibility;
    status: ArticleStatus;
    roleCodes: string;
  }): ArticleVersionResponse {
    return {
      ...this.toVersionSummary(version),
      title: version.title,
      summary: version.summary,
      content: version.content,
      category: version.category,
      tags: version.tags.split(",").filter(Boolean),
      titleColor: version.titleColor,
      visibility: version.visibility,
      status: version.status,
      roleCodes: version.roleCodes.split(",").filter(Boolean),
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
    return {
      id: article.id,
      title: article.title,
      slug: article.slug,
      summary: article.summary,
      content: article.content,
      coverPath: article.coverPath,
      category: article.category,
      tags: article.tags ? article.tags.split(",").filter(Boolean) : [],
      titleColor: article.titleColor,
      visibility: article.visibility,
      status: article.status,
      isPinned: article.isPinned,
      pinOrder: article.pinOrder,
      publishedAt: article.publishedAt?.toISOString() ?? null,
      blockedReason: article.blockedReason,
      viewCount: article.viewCount,
      likeCount: article.likeCount,
      favoriteCount: article.favoriteCount,
      commentCount: article.commentCount,
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
      author: {
        select: {
          id: true,
          nickname: true,
          username: true,
          avatarStoredName: true,
          isSuperAdmin: true,
          role: { select: { code: true, name: true, level: true } },
        },
      },
    } as const;
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
    author: {
      id: number;
      nickname: string;
      username: string;
      avatarStoredName: string | null;
      isSuperAdmin: boolean;
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
    role: { code: string; name: string; level: number };
  }): ArticleAuthorResponse {
    return {
      id: author.id,
      nickname: author.nickname || author.username,
      username: author.username,
      avatarUrl: author.avatarStoredName ? `/auth/avatars/${author.avatarStoredName}` : null,
      isSuperAdmin: author.isSuperAdmin,
      role: {
        code: author.role.code,
        name: author.isSuperAdmin ? "超级管理员" : author.role.name,
        level: author.role.level,
      },
    };
  }

  createVisitorKey(userAgent: string, ip: string, userId?: number): string {
    if (userId) return `user:${userId}`;
    return createHash("sha256").update(`${ip}|${userAgent}`).digest("hex");
  }
}
