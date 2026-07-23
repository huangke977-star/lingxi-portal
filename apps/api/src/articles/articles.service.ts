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
  ArticleVisibility,
  Prisma,
  UserNotificationType,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import {
  ARTICLE_STATUSES,
  ArticleStatusValue,
  CreateArticleCommentDto,
  CreateArticleDto,
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

const commentReportInclude = {
  comment: {
    select: {
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

  constructor(private readonly prisma: PrismaService) {}

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
    const [discover, mine, favorites, liked, manage] = await Promise.all([
      this.prisma.article.count({ where: visibleWhere }),
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
      canManage ? this.prisma.article.count() : Promise.resolve(0),
    ]);

    return { discover, mine, favorites, liked, manage };
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
    return this.toResponse(article, user.id);
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

  async listComments(slug: string, user: AuthenticatedUser | null): Promise<ArticleCommentsResponse> {
    const article = await this.getArticleBySlug(slug);
    this.assertCanRead(article, user);
    const comments = await this.prisma.articleComment.findMany({
      where: { articleId: article.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: this.commentSelect(),
    });
    const includedIds = this.visibleCommentIds(comments);
    const visibleComments = comments.filter((comment) => includedIds.has(comment.id));
    const commentIds = visibleComments.map((comment) => comment.id);
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
    return {
      items: visibleComments.map((comment) => this.toCommentResponse(comment, {
        liked: likedIds.has(comment.id),
        reported: reportedIds.has(comment.id),
        sanitizeHiddenBody: true,
      })),
    };
  }

  async create(user: AuthenticatedUser, dto: CreateArticleDto): Promise<ArticleResponse> {
    const title = dto.title.trim();
    const content = dto.content.trim();
    if (!title || !content) {
      throw new BadRequestException("文章标题和正文不能为空。");
    }

    const visibility = dto.visibility ?? ArticleVisibility.public;
    const roles = await this.resolveRoles(visibility, dto.roleCodes ?? []);
    const status = this.normalizeAuthorStatus(dto.status);
    const article = await this.prisma.article.create({
      data: {
        authorId: user.id,
        title,
        slug: await this.createUniqueSlug(title),
        summary: dto.summary?.trim() ?? "",
        content,
        category: dto.category?.trim() ?? "",
        tags: this.normalizeTags(dto.tags),
        titleColor: this.normalizeTitleColor(dto.titleColor),
        visibility,
        status,
        publishedAt: status === ArticleStatus.published ? new Date() : null,
        allowedRoles: { create: roles.map((role) => ({ roleId: role.id })) },
      },
      include: articleInclude,
    });
    return this.toResponse(article, user.id);
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
    const article = await this.prisma.article.update({
      where: { id },
      data: {
        title: dto.title?.trim() || existing.title,
        summary: dto.summary === undefined ? existing.summary : dto.summary.trim(),
        content: dto.content === undefined ? existing.content : dto.content.trim(),
        category: dto.category === undefined ? existing.category : dto.category.trim(),
        tags: dto.tags === undefined ? existing.tags : this.normalizeTags(dto.tags),
        titleColor: dto.titleColor === undefined ? existing.titleColor : this.normalizeTitleColor(dto.titleColor),
        visibility,
        status,
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
      },
      include: articleInclude,
    });
    return this.toResponse(article, user.id);
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
    const article = await this.prisma.article.update({
      where: { id },
      data: { status: ArticleStatus.published, publishedAt: new Date(), blockedReason: null },
      include: articleInclude,
    });
    return this.toResponse(article, user.id);
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
    return this.toResponse(article, user.id);
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
    return this.toResponse(article, user.id);
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
    await this.assertArticleInteractionAllowed(id, user);
    const existing = await this.prisma.articleLike.findUnique({ where: { articleId_userId: { articleId: id, userId: user.id } } });
    if (liked && !existing) {
      await this.prisma.$transaction([
        this.prisma.articleLike.create({ data: { articleId: id, userId: user.id } }),
        this.prisma.article.update({ where: { id }, data: { likeCount: { increment: 1 } } }),
      ]);
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
    await this.assertArticleInteractionAllowed(id, user);
    const existing = await this.prisma.articleFavorite.findUnique({ where: { articleId_userId: { articleId: id, userId: user.id } } });
    if (favorited && !existing) {
      await this.prisma.$transaction([
        this.prisma.articleFavorite.create({ data: { articleId: id, userId: user.id } }),
        this.prisma.article.update({ where: { id }, data: { favoriteCount: { increment: 1 } } }),
      ]);
    } else if (!favorited && existing) {
      await this.prisma.$transaction([
        this.prisma.articleFavorite.delete({ where: { articleId_userId: { articleId: id, userId: user.id } } }),
        this.prisma.article.update({ where: { id }, data: { favoriteCount: { decrement: 1 } } }),
      ]);
    }
    const article = await this.prisma.article.findUniqueOrThrow({ where: { id }, select: { likeCount: true, favoriteCount: true } });
    return { favorited, likeCount: article.likeCount, favoriteCount: Math.max(0, article.favoriteCount) };
  }

  async createComment(id: number, user: AuthenticatedUser, dto: CreateArticleCommentDto): Promise<ArticleCommentResponse> {
    const article = await this.getArticleOrThrow(id);
    this.assertCanRead(article, user);
    const body = dto.body.trim();
    if (!body) {
      throw new BadRequestException("评论内容不能为空。");
    }
    if (dto.parentId) {
      const parent = await this.prisma.articleComment.findFirst({ where: { id: dto.parentId, articleId: id, status: ArticleCommentStatus.active }, select: { id: true } });
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
    const article = await this.prisma.article.update({
      where: { id },
      data: {
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
      },
      include: articleInclude,
    });
    return this.toResponse(article, actor.id);
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
    await this.prisma.$transaction(async (transaction) => {
      const report = await transaction.articleCommentReport.findUnique({
        where: { id },
        select: {
          commentId: true,
          reporterId: true,
          status: true,
          comment: { select: { article: { select: { title: true, slug: true } } } },
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
      await transaction.userNotification.create({
        data: {
          userId: report.reporterId,
          actorId: actor.id,
          type: resolved
            ? UserNotificationType.comment_report_resolved
            : UserNotificationType.comment_report_rejected,
          title: resolved ? "举报已处理" : "举报已驳回",
          body: (resolution
            ? `你对《${report.comment.article.title}》中评论的举报处理结果：${resolution}`
            : `你对《${report.comment.article.title}》中评论的举报已${resolved ? "处理" : "驳回"}。`).slice(0, 500),
          actionUrl: `/articles/${report.comment.article.slug}?commentId=${report.commentId}`,
          commentReportId: id,
        },
      });
    });
    return { success: true };
  }

  private async listArticles(
    query: ListArticlesQueryDto,
    user: AuthenticatedUser | null,
    admin: boolean,
    mine = false,
  ): Promise<ArticleListResponse> {
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
      items: items.map((article) => this.toResponse(article, user?.id)),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
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
      items: articles.map((article) => this.toResponse(article, user.id)),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
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
    if (query.sort === "popular") return [{ viewCount: "desc" }, { publishedAt: "desc" }, { id: "desc" }];
    if (query.sort === "pinned") return [{ pinOrder: "asc" }, { publishedAt: "desc" }, { id: "desc" }];
    return admin
      ? [{ isPinned: "desc" }, { pinOrder: "asc" }, { updatedAt: "desc" }, { id: "desc" }]
      : [{ isPinned: "desc" }, { pinOrder: "asc" }, { publishedAt: "desc" }, { id: "desc" }];
  }

  private async getBySlug(slug: string, user: AuthenticatedUser | null, visitorKey: string): Promise<ArticleResponse> {
    const article = await this.getArticleBySlug(slug);
    this.assertCanRead(article, user);
    if (article.status === ArticleStatus.published) {
      await this.recordView(article.id, user?.id ?? null, visitorKey);
    }
    const refreshed = await this.getArticleOrThrow(article.id);
    return this.toResponse(refreshed, user?.id);
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

  private async assertArticleInteractionAllowed(id: number, user: AuthenticatedUser): Promise<void> {
    const article = await this.getArticleOrThrow(id);
    this.assertCanRead(article, user);
    if (article.status !== ArticleStatus.published) throw new BadRequestException("文章当前不能互动。");
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

  private toResponse(article: ArticleRecord, viewerId?: number): ArticleResponse {
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
      images: article.images.map((image) => `/articles/images/${image.storedName}`),
      liked: viewerId !== undefined && article.likes.some((like) => like.userId === viewerId),
      favorited: viewerId !== undefined && article.favorites.some((favorite) => favorite.userId === viewerId),
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
