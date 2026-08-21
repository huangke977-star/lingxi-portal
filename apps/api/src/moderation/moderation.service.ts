import { Injectable } from "@nestjs/common";
import {
  ArticleCommentReportStatus,
  ChatGroupReportStatus,
  Prisma,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ListModerationReportsQueryDto, ModerationReportSource } from "./dto/moderation.dto";
import type {
  ModerationReportPageResponse,
  ModerationReportResponse,
  ModerationReportSummaryResponse,
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
      attachments: { select: { kind: true, originalName: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  },
} satisfies Prisma.ChatGroupMessageReportSelect;

type CommentReportRecord = Prisma.ArticleCommentReportGetPayload<{ select: typeof commentReportSelect }>;
type ArticleReportRecord = Prisma.ArticleReportGetPayload<{ select: typeof articleReportSelect }>;
type GroupReportRecord = Prisma.ChatGroupMessageReportGetPayload<{ select: typeof groupReportSelect }>;

@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

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
        attachments: report.message.attachments,
        createdAt: report.message.createdAt.toISOString(),
      },
      createdAt: report.createdAt.toISOString(),
      handledAt: report.handledAt?.toISOString() ?? null,
    };
  }
}
