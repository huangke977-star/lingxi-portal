import { ArticleStatus, ArticleVisibility } from "../src/generated/prisma/client";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { ArticlesService } from "../src/articles/articles.service";
import { ListArticlesQueryDto } from "../src/articles/dto/article.dto";

const user: AuthenticatedUser = {
  id: 7,
  username: "writer",
  nickname: "写作者",
  email: "writer@example.com",
  status: "active",
  isSuperAdmin: false,
  avatarUrl: null,
  profileBio: "",
  createdAt: new Date("2026-07-20T00:00:00.000Z"),
  appearance: {
    themeId: "sakura-mist",
    customAccent: "#db2777",
    customSurface: "#ffffff",
    customForeground: "#2b2530",
    customMuted: "#665867",
    cardAlpha: 52,
    glassBlur: 22,
    glassTint: "#fff3f6",
    glassTintAlpha: 72,
  },
  role: { code: "qi_refining", name: "练气", level: 10 },
};

function articleRecord(status: ArticleStatus = ArticleStatus.published) {
  return {
    id: 12,
    authorId: user.id,
    title: "服务器经验",
    slug: "server-notes-12345678",
    summary: "摘要",
    content: "正文",
    coverPath: null,
    category: "运维",
    tags: "服务器,经验",
    titleColor: "",
    visibility: ArticleVisibility.public,
    status,
    isPinned: false,
    pinOrder: 0,
    publishedAt: new Date("2026-07-20T00:00:00.000Z"),
    blockedReason: null,
    viewCount: 3,
    likeCount: 2,
    favoriteCount: 1,
    commentCount: 0,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    updatedAt: new Date("2026-07-21T00:00:00.000Z"),
    author: {
      id: user.id,
      nickname: user.nickname,
      username: user.username,
      avatarStoredName: null,
      isSuperAdmin: false,
      role: user.role,
    },
    allowedRoles: [],
    images: [],
    likes: [{ userId: user.id }],
    favorites: [{ userId: user.id }],
    comments: [
      {
        authorId: 9,
        author: {
          id: 9,
          nickname: "回复者",
          username: "commenter",
          avatarStoredName: null,
          isSuperAdmin: false,
          role: { code: "qi_refining", name: "练气", level: 10 },
        },
      },
      {
        authorId: 9,
        author: {
          id: 9,
          nickname: "回复者",
          username: "commenter",
          avatarStoredName: null,
          isSuperAdmin: false,
          role: { code: "qi_refining", name: "练气", level: 10 },
        },
      },
      {
        authorId: 10,
        author: {
          id: 10,
          nickname: "另一位回复者",
          username: "commenter-2",
          avatarStoredName: null,
          isSuperAdmin: false,
          role: { code: "foundation_building", name: "筑基", level: 20 },
        },
      },
    ],
  };
}

function createPrismaMock() {
  return {
    article: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => articleRecord(ArticleStatus.deleted)),
      update: jest.fn(async () => articleRecord(ArticleStatus.draft)),
      delete: jest.fn(async () => articleRecord(ArticleStatus.deleted)),
      groupBy: jest.fn(async () => [
        { status: ArticleStatus.draft, _count: { _all: 2 } },
        { status: ArticleStatus.published, _count: { _all: 3 } },
        { status: ArticleStatus.deleted, _count: { _all: 1 } },
      ]),
    },
    articleFavorite: {
      count: jest.fn(async (_args: unknown) => {
        void _args;
        return 1;
      }),
      findMany: jest.fn(async (_args: unknown) => {
        void _args;
        return [{ article: articleRecord() }];
      }),
    },
    articleLike: {
      count: jest.fn(async (_args: unknown) => {
        void _args;
        return 1;
      }),
      findMany: jest.fn(async (_args: unknown) => {
        void _args;
        return [{ article: articleRecord() }];
      }),
    },
  };
}

describe("ArticlesService article center extensions", () => {
  it("lists favorites in interaction order and applies expanded search", async () => {
    const prisma = createPrismaMock();
    const service = new ArticlesService(prisma as unknown as PrismaService);
    const query = Object.assign(new ListArticlesQueryDto(), {
      search: "写作者",
      page: 1,
      pageSize: 10,
    });

    const result = await service.listFavorites(query, user);

    expect(result.total).toBe(1);
    expect(result.items[0].favorited).toBe(true);
    expect(result.items[0].recentCommenters).toEqual([
      expect.objectContaining({ nickname: "回复者", username: "commenter" }),
      expect.objectContaining({ nickname: "另一位回复者", username: "commenter-2" }),
    ]);
    const args = prisma.articleFavorite.findMany.mock.calls[0][0] as {
      orderBy: Array<{ createdAt: string }>;
      where: { article: { AND: Array<{ OR: unknown[] }> } };
    };
    expect(args.orderBy).toEqual([{ createdAt: "desc" }]);
    expect(args.where.article.AND[0].OR).toEqual(expect.arrayContaining([
      { category: { contains: "写作者" } },
      { tags: { contains: "写作者" } },
      { author: { is: { nickname: { contains: "写作者" } } } },
    ]));
  });

  it("returns creation counts for every author status", async () => {
    const prisma = createPrismaMock();
    const service = new ArticlesService(prisma as unknown as PrismaService);

    await expect(service.getMineSummary(user)).resolves.toEqual({
      total: 6,
      draft: 2,
      published: 3,
      unpublished: 0,
      blocked: 0,
      deleted: 1,
    });
  });

  it("returns all article-center tab counts in one summary", async () => {
    const prisma = createPrismaMock();
    prisma.article.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(7);
    prisma.articleFavorite.count.mockResolvedValueOnce(2);
    prisma.articleLike.count.mockResolvedValueOnce(3);
    const service = new ArticlesService(prisma as unknown as PrismaService);
    const adminUser = { ...user, isSuperAdmin: true };

    await expect(service.getCenterSummary(adminUser)).resolves.toEqual({
      discover: 5,
      mine: 4,
      favorites: 2,
      liked: 3,
      manage: 7,
    });
  });

  it("restores deleted articles as unpinned drafts", async () => {
    const prisma = createPrismaMock();
    const service = new ArticlesService(prisma as unknown as PrismaService);

    const restored = await service.restore(12, user);

    expect(restored.status).toBe("draft");
    expect(prisma.article.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 12 },
      data: expect.objectContaining({ status: ArticleStatus.draft, isPinned: false, pinOrder: 0 }),
    }));
  });

  it("permanently deletes only items already in the recycle bin", async () => {
    const prisma = createPrismaMock();
    const service = new ArticlesService(prisma as unknown as PrismaService);

    await expect(service.permanentlyDelete(12, user)).resolves.toEqual({ success: true });
    expect(prisma.article.delete).toHaveBeenCalledWith({ where: { id: 12 } });
  });

  it("soft deletes an owned comment and recalculates the active comment count", async () => {
    const transaction = {
      articleComment: {
        update: jest.fn(async () => ({ articleId: 12 })),
        count: jest.fn(async () => 4),
      },
      article: { update: jest.fn(async () => ({ id: 12 })) },
    };
    const prisma = {
      articleComment: {
        findUnique: jest.fn(async () => ({ authorId: user.id, status: "active" })),
      },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
    };
    const service = new ArticlesService(prisma as unknown as PrismaService);

    await expect(service.deleteComment(44, user)).resolves.toEqual({ success: true });
    expect(transaction.articleComment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 44 },
      data: { status: "deleted" },
    }));
    expect(transaction.article.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { commentCount: 4 },
    });
  });

  it("updates a report and creates the reporter notification in the same transaction", async () => {
    const transaction = {
      articleCommentReport: {
        findUnique: jest.fn(async () => ({
          commentId: 44,
          reporterId: 19,
          status: "pending",
          comment: { article: { title: "测试文章", slug: "test-article" } },
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      userNotification: { create: jest.fn(async () => ({ id: 7 })) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
    };
    const service = new ArticlesService(prisma as unknown as PrismaService);
    const actor = { ...user, isSuperAdmin: true };

    await expect(service.moderateCommentReport(6, actor, {
      status: "resolved",
      resolution: "已处理违规内容",
    })).resolves.toEqual({ success: true });

    expect(transaction.articleCommentReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 6, status: "pending" },
      data: expect.objectContaining({ status: "resolved", handledById: actor.id }),
    }));
    expect(transaction.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 19,
        actorId: actor.id,
        type: "comment_report_resolved",
        commentReportId: 6,
        actionUrl: "/articles/test-article?commentId=44",
      }),
    }));
  });

  it("does not create another notification for an already handled report", async () => {
    const transaction = {
      articleCommentReport: {
        findUnique: jest.fn(async () => ({
          commentId: 44,
          reporterId: 19,
          status: "resolved",
          comment: { article: { title: "测试文章", slug: "test-article" } },
        })),
      },
      userNotification: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
    };
    const service = new ArticlesService(prisma as unknown as PrismaService);
    const actor = { ...user, isSuperAdmin: true };

    await expect(service.moderateCommentReport(6, actor, {
      status: "resolved",
    })).rejects.toThrow("已经处理");
    expect(transaction.userNotification.create).not.toHaveBeenCalled();
  });
});
